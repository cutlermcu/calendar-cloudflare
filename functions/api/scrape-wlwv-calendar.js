export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { 
      targetMonth = new Date().toISOString().slice(0, 7), // YYYY-MM format
      department = 'Life',
      school = 'wlhs',
      fetchOnly = false // If true, only return events without inserting
    } = body;

    // The Blackboard calendar likely has a JSON API endpoint
    // We need to find the actual API calls the calendar makes
    // These are common patterns for Blackboard calendars:
    
    const baseUrl = 'https://www.wlwv.k12.or.us';
    const calendarId = '3526'; // From your URL
    
    // Try different possible API endpoints
    const possibleEndpoints = [
      `/cms/Tools/Calendar/CalendarHandler.ashx?action=list&calendar_id=${calendarId}&start_date=${targetMonth}-01&end_date=${targetMonth}-31`,
      `/api/calendar/${calendarId}/events?month=${targetMonth}`,
      `/AJAXCalendar.aspx?calendar_id=${calendarId}&view=month&date=${targetMonth}`,
      `/cms/calendar/events?id=${calendarId}&month=${targetMonth}`
    ];

    let events = [];
    let foundEndpoint = false;

    // Try each endpoint
    for (const endpoint of possibleEndpoints) {
      try {
        console.log(`Trying endpoint: ${baseUrl}${endpoint}`);
        const response = await fetch(`${baseUrl}${endpoint}`, {
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (compatible; CalendarScraper/1.0)'
          }
        });

        if (response.ok) {
          const contentType = response.headers.get('content-type');
          
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            events = parseBlackboardEvents(data, department, school);
            foundEndpoint = true;
            break;
          }
        }
      } catch (err) {
        console.error(`Failed endpoint ${endpoint}:`, err);
      }
    }

    // If JSON endpoints don't work, fall back to HTML parsing
    if (!foundEndpoint) {
      console.log('Falling back to HTML parsing...');
      events = await scrapeHTMLCalendar(baseUrl, calendarId, targetMonth, department, school);
    }

    // Filter out A/B day schedule entries
    events = events.filter(event => {
      const titleLower = event.title.toLowerCase();
      // Filter out entries that are just "A day", "B day", "A Day", "B Day", etc.
      return !(
        titleLower === 'a day' || 
        titleLower === 'b day' ||
        titleLower === 'day a' ||
        titleLower === 'day b' ||
        titleLower.match(/^[ab]\s+day$/i) ||
        titleLower.match(/^day\s+[ab]$/i)
      );
    });

    // If fetch only, return the events without inserting
    if (fetchOnly) {
      return new Response(JSON.stringify({ 
        success: true,
        month: targetMonth,
        events: events
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Insert events into database
    let inserted = 0;
    let skipped = 0;
    let errors = [];

    for (const event of events) {
      try {
        // Check if event already exists
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
      processed: events.length,
      inserted: inserted,
      skipped: skipped,
      errors: errors,
      events: events
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
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

// Parse Blackboard JSON response
function parseBlackboardEvents(data, department, school) {
  const events = [];
  
  // Handle different possible JSON structures
  let eventList = [];
  
  if (Array.isArray(data)) {
    eventList = data;
  } else if (data.events && Array.isArray(data.events)) {
    eventList = data.events;
  } else if (data.Items && Array.isArray(data.Items)) {
    eventList = data.Items;
  }

  for (const item of eventList) {
    try {
      // Common Blackboard event properties
      const event = {
        date: parseBlackboardDate(item.StartDate || item.start_date || item.EventDate || item.date),
        title: item.Title || item.title || item.EventTitle || item.name || 'Untitled Event',
        time: parseBlackboardTime(item.StartTime || item.start_time || item.Time),
        description: item.Description || item.description || item.Details || '',
        department: department,
        school: school
      };

      // Skip A/B day entries at the individual parsing level too
      const titleLower = event.title.toLowerCase();
      if (titleLower === 'a day' || 
          titleLower === 'b day' ||
          titleLower === 'day a' ||
          titleLower === 'day b' ||
          titleLower.match(/^[ab]\s+day$/i) ||
          titleLower.match(/^day\s+[ab]$/i)) {
        return; // Skip this event
      }

      if (event.date) {
        events.push(event);
      }
    } catch (err) {
      console.error('Error parsing event:', err);
    }
  }

  return events;
}

// Fallback HTML scraping method
async function scrapeHTMLCalendar(baseUrl, calendarId, targetMonth, department, school) {
  const events = [];
  
  try {
    // Request the calendar page with specific parameters
    const [year, month] = targetMonth.split('-');
    const url = `${baseUrl}/Page/3071#calendar${calendarId}/${year}${month}01/month`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; CalendarScraper/1.0)'
      }
    });

    const html = await response.text();
    
    // Look for JavaScript variables that might contain event data
    const scriptMatches = html.matchAll(/var\s+(?:events|calendarData|eventData)\s*=\s*(\[[\s\S]*?\]);/g);
    
    for (const match of scriptMatches) {
      try {
        const jsonStr = match[1];
        const data = JSON.parse(jsonStr);
        const parsedEvents = parseBlackboardEvents(data, department, school);
        events.push(...parsedEvents);
      } catch (err) {
        console.error('Failed to parse embedded JSON:', err);
      }
    }

    // Also look for data attributes or hidden inputs
    const dataMatches = html.matchAll(/data-events=['"]([^'"]+)['"]/g);
    for (const match of dataMatches) {
      try {
        const jsonStr = match[1].replace(/&quot;/g, '"');
        const data = JSON.parse(jsonStr);
        const parsedEvents = parseBlackboardEvents(data, department, school);
        events.push(...parsedEvents);
      } catch (err) {
        console.error('Failed to parse data attribute:', err);
      }
    }
  } catch (err) {
    console.error('HTML scraping failed:', err);
  }

  return events;
}

// Parse various date formats used by Blackboard
function parseBlackboardDate(dateStr) {
  if (!dateStr) return null;
  
  try {
    // Handle different date formats
    // Format: "2025-06-13T00:00:00"
    if (dateStr.includes('T')) {
      return dateStr.split('T')[0];
    }
    
    // Format: "6/13/2025"
    if (dateStr.includes('/')) {
      const [month, day, year] = dateStr.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // Format: "June 13, 2025"
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];
    for (let i = 0; i < monthNames.length; i++) {
      if (dateStr.includes(monthNames[i])) {
        const match = dateStr.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
        if (match) {
          const monthNum = i + 1;
          return `${match[3]}-${monthNum.toString().padStart(2, '0')}-${match[2].padStart(2, '0')}`;
        }
      }
    }
    
    // Try parsing as-is
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (err) {
    console.error('Date parsing error:', err);
  }
  
  return null;
}

// Parse time formats
function parseBlackboardTime(timeStr) {
  if (!timeStr) return null;
  
  try {
    // Remove any extra whitespace
    timeStr = timeStr.trim();
    
    // Format: "3:00 PM"
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const meridiem = match[3];
      
      if (meridiem) {
        if (meridiem.toUpperCase() === 'PM' && hours < 12) {
          hours += 12;
        } else if (meridiem.toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
        }
      }
      
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  } catch (err) {
    console.error('Time parsing error:', err);
  }
  
  return null;
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
