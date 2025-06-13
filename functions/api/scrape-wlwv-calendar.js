// functions/api/scrape-wlwv-calendar.js

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

    // Found the actual Blackboard API endpoint from diagnostic
    const baseUrl = 'https://www.wlwv.k12.or.us';
    const calendarId = '3526';
    
    // Parse the target month to get start and end dates
    const [year, month] = targetMonth.split('-').map(n => parseInt(n));
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of the month
    
    // Format dates for the API (M/D/YYYY format)
    const startDateStr = `${month}/${startDate.getDate()}/${year}`;
    const endDateStr = `${month}/${endDate.getDate()}/${year}`;
    
    let events = [];
    
    try {
      // Use the actual API endpoint discovered by diagnostic
      const apiUrl = `${baseUrl}/site/UserControls/Calendar/CalendarController.aspx/GetEvents`;
      
      console.log(`Fetching events from ${startDateStr} to ${endDateStr}`);
      
      // Blackboard typically expects POST requests with specific format
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          calendarId: parseInt(calendarId),
          startDate: startDateStr,
          endDate: endDateStr,
          templatePath: '',
          templateName: '',
          calendarName: '',
          culture: 'en-US'
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('API Response:', data);
        
        // Blackboard typically returns data in a 'd' property
        const eventData = data.d || data;
        events = parseBlackboardAPIResponse(eventData, department, school);
      } else {
        console.error('API request failed:', response.status, response.statusText);
        // Try alternative request format
        events = await tryAlternativeFormats(baseUrl, calendarId, startDateStr, endDateStr, department, school);
      }
    } catch (err) {
      console.error('Failed to fetch from API:', err);
      // Fall back to scraping if API fails
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

// Parse Blackboard API response
function parseBlackboardAPIResponse(data, department, school) {
  const events = [];
  
  try {
    // Handle different response structures
    let eventList = [];
    
    if (typeof data === 'string') {
      // Sometimes the response is a JSON string that needs parsing
      try {
        data = JSON.parse(data);
      } catch (e) {
        console.error('Failed to parse string response:', e);
        return events;
      }
    }
    
    if (Array.isArray(data)) {
      eventList = data;
    } else if (data && data.Events) {
      eventList = data.Events;
    } else if (data && data.items) {
      eventList = data.items;
    } else if (data && data.data) {
      eventList = data.data;
    }
    
    console.log(`Found ${eventList.length} raw events`);
    
    for (const item of eventList) {
      try {
        // Blackboard calendar event structure
        const event = {
          date: parseBlackboardDate(
            item.Start || item.StartDate || item.EventDate || item.Date || item.start
          ),
          title: item.Title || item.EventTitle || item.Subject || item.title || 'Untitled Event',
          time: parseBlackboardTime(
            item.StartTime || item.Time || item.start
          ),
          description: item.Description || item.Body || item.desc || '',
          department: department,
          school: school
        };

        // Skip A/B day entries
        const titleLower = event.title.toLowerCase();
        if (titleLower === 'a day' || 
            titleLower === 'b day' ||
            titleLower === 'day a' ||
            titleLower === 'day b' ||
            titleLower.match(/^[ab]\s+day$/i) ||
            titleLower.match(/^day\s+[ab]$/i)) {
          console.log('Skipping A/B day entry:', event.title);
          continue;
        }

        if (event.date && event.title) {
          events.push(event);
          console.log('Added event:', event.title, event.date);
        }
      } catch (err) {
        console.error('Error parsing event:', err, item);
      }
    }
  } catch (err) {
    console.error('Error in parseBlackboardAPIResponse:', err);
  }
  
  return events;
}

// Try alternative API request formats
async function tryAlternativeFormats(baseUrl, calendarId, startDate, endDate, department, school) {
  const events = [];
  
  // Try GET request with query parameters
  try {
    const getUrl = `${baseUrl}/site/UserControls/Calendar/CalendarController.aspx/GetEvents?calendarId=${calendarId}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
    
    const response = await fetch(getUrl, {
      headers: {
        'Accept': 'application/json, text/plain, */*'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return parseBlackboardAPIResponse(data.d || data, department, school);
    }
  } catch (err) {
    console.error('GET request failed:', err);
  }
  
  // Try form-encoded POST
  try {
    const formData = new URLSearchParams();
    formData.append('calendarId', calendarId);
    formData.append('startDate', startDate);
    formData.append('endDate', endDate);
    
    const response = await fetch(`${baseUrl}/site/UserControls/Calendar/CalendarController.aspx/GetEvents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: formData.toString()
    });
    
    if (response.ok) {
      const data = await response.json();
      return parseBlackboardAPIResponse(data.d || data, department, school);
    }
  } catch (err) {
    console.error('Form-encoded POST failed:', err);
  }
  
  return events;
}

// Parse Blackboard JSON response (keep for compatibility)
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
