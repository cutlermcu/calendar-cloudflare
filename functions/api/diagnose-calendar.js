export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url') || 'https://www.wlwv.k12.or.us/Page/3071';
  
  try {
    console.log('Diagnosing calendar at:', targetUrl);
    
    // Try to fetch the page
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    const html = await response.text();
    
    // Look for various patterns that might contain calendar data
    const diagnostics = {
      url: targetUrl,
      status: response.status,
      contentLength: html.length,
      patterns: {}
    };
    
    // Check for common calendar patterns
    const patterns = [
      {
        name: 'JavaScript variables',
        regex: /var\s+(\w*(?:calendar|event|data|items)\w*)\s*=\s*(\[[\s\S]{0,1000}?\]|\{[\s\S]{0,1000}?\})/gi,
        matches: []
      },
      {
        name: 'Calendar widget scripts',
        regex: /<script[^>]*src=['"]([^'"]*calendar[^'"]*)['"]/gi,
        matches: []
      },
      {
        name: 'API endpoints in JavaScript',
        regex: /['"]([^'"]*(?:api|calendar|events|handler)[^'"]*\.(?:aspx|ashx|json))['"]/gi,
        matches: []
      },
      {
        name: 'Data attributes',
        regex: /data-(?:calendar|events|config)=['"]([^'"]+)['"]/gi,
        matches: []
      },
      {
        name: 'Calendar container IDs',
        regex: /id=['"]([^'"]*calendar[^'"]*)['"]/gi,
        matches: []
      },
      {
        name: 'Blackboard specific patterns',
        regex: /(?:CalendarHandler|AJAXCalendar|bb-calendar)[\s\S]{0,200}?(['"][\s\S]{0,500}?['"])/gi,
        matches: []
      },
      {
        name: 'JSON-LD structured data',
        regex: /<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi,
        matches: []
      }
    ];
    
    // Search for each pattern
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.regex.exec(html)) !== null) {
        pattern.matches.push(match[1].substring(0, 200)); // Limit length for readability
      }
    });
    
    diagnostics.patterns = patterns.reduce((acc, p) => {
      if (p.matches.length > 0) {
        acc[p.name] = p.matches;
      }
      return acc;
    }, {});
    
    // Look for iframes that might contain the calendar
    const iframeMatches = html.match(/<iframe[^>]*src=['"]([^'"]+)['"]/gi);
    if (iframeMatches) {
      diagnostics.iframes = iframeMatches.map(m => {
        const srcMatch = m.match(/src=['"]([^'"]+)['"]/i);
        return srcMatch ? srcMatch[1] : null;
      }).filter(Boolean);
    }
    
    // Check for AJAX configuration
    const ajaxConfig = html.match(/\$\.ajax\s*\(\s*\{[\s\S]*?url\s*:\s*['"]([^'"]+)['"]/gi);
    if (ajaxConfig) {
      diagnostics.ajaxUrls = ajaxConfig.map(m => {
        const urlMatch = m.match(/url\s*:\s*['"]([^'"]+)['"]/i);
        return urlMatch ? urlMatch[1] : null;
      }).filter(Boolean);
    }
    
    // Look for calendar initialization code
    const calendarInit = html.match(/(?:initCalendar|loadCalendar|Calendar\.init|new Calendar)\s*\([^)]*\)/gi);
    if (calendarInit) {
      diagnostics.calendarInitialization = calendarInit.map(m => m.substring(0, 100));
    }
    
    // Extract any inline event data
    const inlineEvents = [];
    const eventPatterns = [
      /"title"\s*:\s*"([^"]+)"/g,
      /"eventTitle"\s*:\s*"([^"]+)"/g,
      /"name"\s*:\s*"([^"]+)"/g
    ];
    
    eventPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        if (!match[1].toLowerCase().includes('day') || match[1].length > 10) {
          inlineEvents.push(match[1]);
        }
      }
    });
    
    if (inlineEvents.length > 0) {
      diagnostics.possibleEvents = inlineEvents.slice(0, 10); // First 10 events
    }
    
    // Summary
    diagnostics.summary = {
      hasCalendarScripts: Object.keys(diagnostics.patterns).some(k => k.includes('script')),
      hasApiEndpoints: !!diagnostics.patterns['API endpoints in JavaScript'],
      hasDataAttributes: !!diagnostics.patterns['Data attributes'],
      hasIframes: !!diagnostics.iframes,
      possibleEventCount: inlineEvents.length
    };
    
    return new Response(JSON.stringify(diagnostics, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Diagnostic failed',
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

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
