// functions/api/scrape-wlwv-export.js

export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { 
      targetMonth = new Date().toISOString().slice(0, 7), // YYYY-MM format
      department = 'Life',
      school = 'wlhs',
      fetchOnly = false
    } = body;

    // Use the export endpoint found in diagnostic
    const baseUrl = 'https://www.wlwv.k12.or.us';
    const exportUrl = '/site/UserControls/Calendar/EventExportByDateRangeWrapper.aspx';
    
    // Parse the target month to get start and end dates
    const [year, month] = targetMonth.split('-').map(n => parseInt(n));
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of the month
    
    // Format dates for the export (M/D/YYYY format)
    const startDateStr = `${month}/${startDate.getDate()}/${year}`;
    const endDateStr = `${month}/${endDate.getDate()}/${year}`;
    
    let events = [];
    
    try {
      // Try the export endpoint with various parameter formats
      const exportParams = new URLSearchParams({
        'calendarId': '3526',
        'startDate': startDateStr,
        'endDate': endDateStr,
        'calendarID': '3526', // Try both cases
        'start': startDateStr,
        'end': endDateStr,
        'format': 'json',
        'export': 'true'
      });
      
      console.log(`Fetching events export from ${startDateStr} to ${endDateStr}`);
      
      // Try GET request first
      let response = await fetch(`${baseUrl}${exportUrl}?${exportParams}`, {
        headers: {
          'Accept': 'application/json, text/calendar, text/plain, */*',
          'Referer': `${baseUrl}/Page/3071`
        }
      });
      
      console.log('Export response status:', response.status);
      
      if (!response.ok) {
        // Try POST request
        response = await fetch(`${baseUrl}${exportUrl}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json, text/calendar, text/plain, */*',
            'Referer': `${baseUrl}/Page/3071`
          },
          body: exportParams.toString()
        });
      }
      
      const contentType = response.headers.get('content-type');
      const responseText = await response.text();
      
      console.log('Content type:', contentType);
      console.log('Response preview:', responseText.substring(0, 500));
      
      if (contentType && contentType.includes('calendar')) {
        // It's returning iCal format
        events = parseICalData(responseText, department, school);
      } else if (contentType && contentType.includes('json')) {
        // JSON format
        const data = JSON.parse(responseText);
        events = parseExportedEvents(data, department, school);
      } else {
        // Try to detect format
        if (responseText.startsWith('BEGIN:VCALENDAR')) {
          events = parseICalData(responseText, department, school);
        } else if (responseText.trim().startsWith('[') || responseText.trim().startsWith('{')) {
          const data = JSON.parse(responseText);
          events = parseExportedEvents(data, department, school);
        } else {
          // HTML response - try to extract download link
          const downloadLink = extractDownloadLink(responseText);
          if (downloadLink) {
            events = await fetchDownloadLink(baseUrl, downloadLink, department, school);
          }
        }
      }
      
    } catch (err) {
      console.error('Export fetch failed:', err);
      
      // Last resort: try to get the RSS feed
      events = await tryRSSFeed(baseUrl, targetMonth, department, school);
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

// Parse iCal format data
function parseICalData(icalText, department, school) {
  const events = [];
  
  try {
    // Split into individual events
    const vevents = icalText.split('BEGIN:VEVENT');
    
    for (let i = 1; i < vevents.length; i++) {
      const vevent = vevents[i];
      
      // Extract properties
      const summary = extractICalProperty(vevent, 'SUMMARY');
      const dtstart = extractICalProperty(vevent, 'DTSTART');
      const description = extractICalProperty(vevent, 'DESCRIPTION');
      
      if (summary && dtstart) {
        const date = parseICalDate(dtstart);
        if (date) {
          events.push({
            title: summary,
            date: date,
            time: extractTimeFromICalDate(dtstart),
            description: description || '',
            department: department,
            school: school
          });
        }
      }
    }
  } catch (err) {
    console.error('iCal parsing error:', err);
  }
  
  return events;
}

// Extract property from iCal event
function extractICalProperty(vevent, property) {
  const match = vevent.match(new RegExp(`${property}:([^\\r\\n]+)`));
  return match ? match[1].trim() : null;
}

// Parse iCal date format
function parseICalDate(dtstart) {
  try {
    // Format: 20250613T120000 or 20250613
    const dateMatch = dtstart.match(/(\d{4})(\d{2})(\d{2})/);
    if (dateMatch) {
      return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    }
  } catch (err) {
    console.error('iCal date parsing error:', err);
  }
  return null;
}

// Extract time from iCal datetime
function extractTimeFromICalDate(dtstart) {
  try {
    const timeMatch = dtstart.match(/T(\d{2})(\d{2})(\d{2})/);
    if (timeMatch) {
      return `${timeMatch[1]}:${timeMatch[2]}`;
    }
  } catch (err) {
    console.error('iCal time parsing error:', err);
  }
  return null;
}

// Parse exported events (JSON format)
function parseExportedEvents(data, department, school) {
  const events = [];
  
  let eventList = Array.isArray(data) ? data : (data.events || data.items || []);
  
  for (const item of eventList) {
    try {
      const event = {
        title: item.title || item.summary || item.name || 'Untitled',
        date: parseExportDate(item.date || item.start || item.startDate),
        time: item.time || parseExportTime(item.start || item.startTime),
        description: item.description || item.details || '',
        department: department,
        school: school
      };
      
      if (event.date && event.title) {
        events.push(event);
      }
    } catch (err) {
      console.error('Event parsing error:', err);
    }
  }
  
  return events;
}

// Parse various date formats from export
function parseExportDate(dateStr) {
  if (!dateStr) return null;
  
  try {
    // ISO format
    if (dateStr.includes('-')) {
      return dateStr.split('T')[0];
    }
    
    // M/D/YYYY format
    if (dateStr.includes('/')) {
      const [month, day, year] = dateStr.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // Try parsing as Date
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (err) {
    console.error('Date parsing error:', err);
  }
  
  return null;
}

// Parse time from various formats
function parseExportTime(timeStr) {
  if (!timeStr) return null;
  
  try {
    // Extract time from ISO datetime
    if (timeStr.includes('T')) {
      const timePart = timeStr.split('T')[1];
      return timePart.substring(0, 5);
    }
    
    // H:MM AM/PM format
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = match[2];
      const meridiem = match[3];
      
      if (meridiem) {
        if (meridiem.toUpperCase() === 'PM' && hours < 12) hours += 12;
        if (meridiem.toUpperCase() === 'AM' && hours === 12) hours = 0;
      }
      
      return `${hours.toString().padStart(2, '0')}:${minutes}`;
    }
  } catch (err) {
    console.error('Time parsing error:', err);
  }
  
  return null;
}

// Extract download link from HTML response
function extractDownloadLink(html) {
  const match = html.match(/href=['"]([^'"]*\.(ics|json|csv)[^'"]*)['"]/i);
  return match ? match[1] : null;
}

// Fetch calendar from download link
async function fetchDownloadLink(baseUrl, link, department, school) {
  try {
    const fullUrl = link.startsWith('http') ? link : baseUrl + link;
    const response = await fetch(fullUrl);
    const content = await response.text();
    
    if (content.includes('BEGIN:VCALENDAR')) {
      return parseICalData(content, department, school);
    } else {
      const data = JSON.parse(content);
      return parseExportedEvents(data, department, school);
    }
  } catch (err) {
    console.error('Download link fetch failed:', err);
  }
  return [];
}

// Try RSS feed as last resort
async function tryRSSFeed(baseUrl, targetMonth, department, school) {
  const events = [];
  
  try {
    // Common RSS feed URLs for Blackboard calendars
    const rssUrls = [
      `/RSS.aspx?type=N&data=3526`,
      `/calendar/rss/3526`,
      `/Page/3071/RSS`
    ];
    
    for (const rssPath of rssUrls) {
      try {
        const response = await fetch(baseUrl + rssPath);
        if (response.ok) {
          const rssText = await response.text();
          const rssEvents = parseRSSFeed(rssText, department, school);
          events.push(...rssEvents);
          if (events.length > 0) break;
        }
      } catch (err) {
        console.error(`RSS feed ${rssPath} failed:`, err);
      }
    }
  } catch (err) {
    console.error('RSS feed fetch failed:', err);
  }
  
  return events;
}

// Parse RSS feed
function parseRSSFeed(rssText, department, school) {
  const events = [];
  
  try {
    const items = rssText.split('<item>');
    
    for (let i = 1; i < items.length; i++) {
      const item = items[i];
      
      const title = extractXMLTag(item, 'title');
      const description = extractXMLTag(item, 'description');
      const pubDate = extractXMLTag(item, 'pubDate');
      
      if (title && pubDate) {
        const date = parseRSSDate(pubDate);
        if (date) {
          events.push({
            title: title,
            date: date,
            time: null,
            description: description || '',
            department: department,
            school: school
          });
        }
      }
    }
  } catch (err) {
    console.error('RSS parsing error:', err);
  }
  
  return events;
}

// Extract XML tag content
function extractXMLTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([^\\]]+)\\]\\]></${tag}>|<${tag}>([^<]+)</${tag}>`));
  return match ? (match[1] || match[2]).trim() : null;
}

// Parse RSS date format
function parseRSSDate(dateStr) {
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (err) {
    console.error('RSS date parsing error:', err);
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
