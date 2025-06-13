// functions/api/scrape-wlwv-html.js

export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { 
      targetMonth = new Date().toISOString().slice(0, 7),
      department = 'Life',
      school = 'wlhs',
      fetchOnly = false
    } = body;

    console.log(`Fetching calendar HTML for ${targetMonth}`);
    
    // Parse the target month
    const [year, month] = targetMonth.split('-');
    
    // Fetch the calendar page with the specific month view
    const calendarUrl = `https://www.wlwv.k12.or.us/Page/3071#calendar3526/${year}${month}01/month`;
    
    console.log('Fetching URL:', calendarUrl);
    
    const response = await fetch(calendarUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch calendar page: ${response.status}`);
    }
    
    const html = await response.text();
    console.log('HTML length:', html.length);
    
    // Try multiple strategies to extract calendar data
    let events = [];
    
    // Strategy 1: Look for JavaScript variables containing event data
    const scriptPatterns = [
      // Common patterns for calendar data in JavaScript
      /var\s+events\s*=\s*(\[[\s\S]*?\]);/,
      /var\s+eventData\s*=\s*(\[[\s\S]*?\]);/,
      /var\s+calendarEvents\s*=\s*(\[[\s\S]*?\]);/,
      /\.fullCalendar\([^,]+,\s*(\[[\s\S]*?\])\s*\)/,
      /events:\s*(\[[\s\S]*?\])[,\s\n\r]*[}\)]/,
      /eventSources:\s*\[\s*(\[[\s\S]*?\])\s*\]/,
      // Blackboard specific patterns
      /Bb\.Calendar\.events\s*=\s*(\[[\s\S]*?\]);/,
      /calendarData\s*:\s*(\{[\s\S]*?\})/,
      // Look for AJAX call parameters
      /\.ajax\s*\(\s*\{[^}]*data\s*:\s*(\{[^}]*calendarId[^}]*\})/
    ];
    
    for (const pattern of scriptPatterns) {
      const matches = html.matchAll(new RegExp(pattern, 'g'));
      for (const match of matches) {
        try {
          console.log('Found potential event data with pattern:', pattern);
          const jsonStr = match[1];
          // Clean up the JSON string
          const cleanJson = jsonStr
            .replace(/new Date\(([^)]+)\)/g, '"$1"') // Replace new Date() with string
            .replace(/(\w+):/g, '"$1":') // Add quotes to property names
            .replace(/'/g, '"') // Replace single quotes with double
            .replace(/,\s*}/g, '}') // Remove trailing commas
            .replace(/,\s*]/g, ']');
          
          const data = JSON.parse(cleanJson);
          const parsedEvents = parseEventData(data, department, school, targetMonth);
          events.push(...parsedEvents);
        } catch (e) {
          console.error('Failed to parse JavaScript data:', e.message);
        }
      }
    }
    
    // Strategy 2: Look for inline event data in data attributes
    const dataEventMatches = html.matchAll(/data-event=['"]([^'"]+)['"]/g);
    for (const match of dataEventMatches) {
      try {
        const eventData = JSON.parse(match[1].replace(/&quot;/g, '"'));
        const event = parseEventObject(eventData, department, school);
        if (event && isEventInMonth(event.date, targetMonth)) {
          events.push(event);
        }
      } catch (e) {
        console.error('Failed to parse data-event:', e);
      }
    }
    
    // Strategy 3: Parse calendar view state or initialization parameters
    const calInitMatch = html.match(/Calendar\.init\s*\(\s*\{([^}]+)\}/);
    if (calInitMatch) {
      try {
        // Extract calendar ID and settings
        const calIdMatch = calInitMatch[1].match(/id\s*:\s*['"]?(\d+)['"]?/);
        const viewMatch = calInitMatch[1].match(/view\s*:\s*['"](\w+)['"]/);
        
        if (calIdMatch) {
          console.log('Found calendar ID:', calIdMatch[1]);
          // Try to make a direct API call with the found calendar ID
          const apiEvents = await tryDirectAPI(calIdMatch[1], targetMonth, department, school);
          events.push(...apiEvents);
        }
      } catch (e) {
        console.error('Failed to parse calendar init:', e);
      }
    }
    
    // Strategy 4: Look for ViewState or other ASP.NET data
    const viewStateMatch = html.match(/<input[^>]+id="__VIEWSTATE"[^>]+value="([^"]+)"/);
    if (viewStateMatch && events.length === 0) {
      console.log('Found ViewState, attempting form-based request...');
      events = await tryFormBasedRequest(viewStateMatch[1], targetMonth, department, school);
    }
    
    // Filter out A/B day entries
    events = events.filter(event => {
      const titleLower = event.title.toLowerCase();
      return !(
        titleLower === 'a day' || 
        titleLower === 'b day' ||
        titleLower === 'day a' ||
        titleLower === 'day b' ||
        titleLower.match(/^[ab]\s+day$/i) ||
        titleLower.match(/^day\s+[ab]$/i)
      );
    });
    
    // Remove duplicates
    const uniqueEvents = [];
    const seen = new Set();
    for (const event of events) {
      const key = `${event.date}-${event.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEvents.push(event);
      }
    }
    
    console.log(`Found ${uniqueEvents.length} unique events after filtering`);
    
    if (fetchOnly) {
      return new Response(JSON.stringify({ 
        success: true,
        month: targetMonth,
        events: uniqueEvents,
        debug: {
          htmlLength: html.length,
          hasViewState: !!viewStateMatch,
          strategiesUsed: events.length > 0 ? 'JavaScript parsing' : 'None successful'
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Insert events (rest of the code remains the same)
    let inserted = 0;
    let skipped = 0;
    let errors = [];

    for (const event of uniqueEvents) {
      try {
        const existing = await env.DB.prepare(
          'SELECT id FROM events WHERE school = ? AND date = ? AND title = ?'
        ).bind(event.school, event.date, event.title).first();
        
        if (!existing) {
          await env.DB.prepare(`
            INSERT INTO events (school, date, title, department, time, description)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            event.school, 
            event.date, 
            event.title, 
            event.department, 
            event.time, 
            event.description
          ).run();
          inserted++;
        } else {
          skipped++;
        }
      } catch (err) {
        errors.push({ event: event.title, error: err.message });
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      month: targetMonth,
      processed: uniqueEvents.length,
      inserted: inserted,
      skipped: skipped,
      errors: errors,
      events: uniqueEvents
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Scraping error:', error);
    return new Response(JSON.stringify({ 
      error: 'Scraping failed',
      details: error.message 
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// Parse event data from various formats
function parseEventData(data, department, school, targetMonth) {
  const events = [];
  
  if (Array.isArray(data)) {
    for (const item of data) {
      const event = parseEventObject(item, department, school);
      if (event && isEventInMonth(event.date, targetMonth)) {
        events.push(event);
      }
    }
  } else if (typeof data === 'object' && data !== null) {
    // Handle nested event arrays
    const possibleArrays = ['events', 'items', 'data', 'results'];
    for (const key of possibleArrays) {
      if (Array.isArray(data[key])) {
        const subEvents = parseEventData(data[key], department, school, targetMonth);
        events.push(...subEvents);
      }
    }
  }
  
  return events;
}

// Parse a single event object
function parseEventObject(item, department, school) {
  try {
    // Extract title - try multiple possible fields
    const title = item.title || item.Title || item.summary || item.Summary || 
                 item.subject || item.Subject || item.name || item.Name || 
                 item.eventTitle || item.EventTitle;
    
    if (!title) return null;
    
    // Extract date
    const dateStr = item.start || item.Start || item.date || item.Date || 
                   item.startDate || item.StartDate || item.eventDate || item.EventDate;
    
    const date = parseDateString(dateStr);
    if (!date) return null;
    
    // Extract time
    const timeStr = item.startTime || item.StartTime || item.time || item.Time;
    const time = parseTimeString(timeStr || dateStr);
    
    // Extract description
    const description = item.description || item.Description || 
                       item.details || item.Details || 
                       item.body || item.Body || '';
    
    return {
      title: title.trim(),
      date: date,
      time: time,
      description: description.trim(),
      department: department,
      school: school
    };
  } catch (e) {
    console.error('Error parsing event object:', e);
    return null;
  }
}

// Parse various date formats
function parseDateString(dateStr) {
  if (!dateStr) return null;
  
  try {
    // Handle Date objects or timestamps
    if (typeof dateStr === 'number' || dateStr instanceof Date) {
      const d = new Date(dateStr);
      return d.toISOString().split('T')[0];
    }
    
    // Handle ISO format
    if (dateStr.includes('T')) {
      return dateStr.split('T')[0];
    }
    
    // Handle formatted strings
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    
    // Try parsing MM/DD/YYYY
    const usFormat = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usFormat) {
      return `${usFormat[3]}-${usFormat[1].padStart(2, '0')}-${usFormat[2].padStart(2, '0')}`;
    }
  } catch (e) {
    console.error('Date parsing error:', e);
  }
  
  return null;
}

// Parse time from various formats
function parseTimeString(timeStr) {
  if (!timeStr) return null;
  
  try {
    // Extract time from ISO datetime
    if (timeStr.includes('T')) {
      const timePart = timeStr.split('T')[1];
      if (timePart) {
        return timePart.substring(0, 5);
      }
    }
    
    // Parse AM/PM format
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2];
      const meridiem = timeMatch[3];
      
      if (meridiem) {
        if (meridiem.toUpperCase() === 'PM' && hours < 12) hours += 12;
        if (meridiem.toUpperCase() === 'AM' && hours === 12) hours = 0;
      }
      
      return `${hours.toString().padStart(2, '0')}:${minutes}`;
    }
  } catch (e) {
    console.error('Time parsing error:', e);
  }
  
  return null;
}

// Check if event is in the target month
function isEventInMonth(dateStr, targetMonth) {
  if (!dateStr) return false;
  return dateStr.startsWith(targetMonth);
}

// Try direct API call with discovered parameters
async function tryDirectAPI(calendarId, targetMonth, department, school) {
  try {
    const [year, month] = targetMonth.split('-').map(n => parseInt(n));
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    
    const response = await fetch('https://www.wlwv.k12.or.us/site/UserControls/Calendar/CalendarController.aspx/GetEvents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({
        calendarId: parseInt(calendarId),
        startDate: `${month}/${startDate.getDate()}/${year}`,
        endDate: `${month}/${endDate.getDate()}/${year}`
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      return parseEventData(data.d || data, department, school, targetMonth);
    }
  } catch (e) {
    console.error('Direct API call failed:', e);
  }
  
  return [];
}

// Try form-based request with ViewState
async function tryFormBasedRequest(viewState, targetMonth, department, school) {
  // This would require simulating an ASP.NET postback
  // For now, return empty array
  console.log('Form-based request not implemented yet');
  return [];
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
