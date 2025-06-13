// functions/api/debug-calendar-api.js

export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { targetMonth = '2025-06' } = body;
    
    const results = {
      timestamp: new Date().toISOString(),
      targetMonth: targetMonth,
      tests: []
    };
    
    // Test 1: Direct API call with exact format from browser
    try {
      const [year, month] = targetMonth.split('-').map(n => parseInt(n));
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      
      // Format exactly as the browser does
      const apiUrl = 'https://www.wlwv.k12.or.us/site/UserControls/Calendar/CalendarController.aspx/GetEvents';
      const payload = {
        calendarId: 3526, // As number, not string
        startDate: `${month}/${startDate.getDate()}/${year}`,
        endDate: `${month}/${endDate.getDate()}/${year}`,
        templatePath: "",
        templateName: "",
        calendarName: "",
        culture: "en-US"
      };
      
      console.log('API Request:', JSON.stringify(payload));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://www.wlwv.k12.or.us',
          'Referer': 'https://www.wlwv.k12.or.us/Page/3071'
        },
        body: JSON.stringify(payload)
      });
      
      const responseText = await response.text();
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      
      results.tests.push({
        name: 'Direct API Call',
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        responseLength: responseText.length,
        responsePreview: responseText.substring(0, 1000),
        isJSON: responseText.trim().startsWith('{') || responseText.trim().startsWith('['),
        payload: payload
      });
      
      // Try to parse if JSON
      if (responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
        try {
          const data = JSON.parse(responseText);
          results.tests[0].parsedData = data;
          results.tests[0].hasD = !!data.d;
          results.tests[0].dataStructure = Object.keys(data);
        } catch (e) {
          results.tests[0].parseError = e.message;
        }
      }
      
    } catch (error) {
      results.tests.push({
        name: 'Direct API Call',
        error: error.message,
        stack: error.stack
      });
    }
    
    // Test 2: Try without some headers
    try {
      const apiUrl = 'https://www.wlwv.k12.or.us/site/UserControls/Calendar/CalendarController.aspx/GetEvents';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          calendarId: 3526,
          startDate: '6/1/2025',
          endDate: '6/30/2025'
        })
      });
      
      const text = await response.text();
      results.tests.push({
        name: 'Minimal Headers Test',
        status: response.status,
        responseLength: text.length,
        responsePreview: text.substring(0, 500)
      });
    } catch (error) {
      results.tests.push({
        name: 'Minimal Headers Test',
        error: error.message
      });
    }
    
    // Test 3: Check for cookies/session requirements
    try {
      // First get the main page
      const pageResponse = await fetch('https://www.wlwv.k12.or.us/Page/3071', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const cookies = pageResponse.headers.get('set-cookie');
      results.tests.push({
        name: 'Cookie Check',
        hasCookies: !!cookies,
        cookies: cookies ? cookies.substring(0, 200) : null,
        pageStatus: pageResponse.status
      });
    } catch (error) {
      results.tests.push({
        name: 'Cookie Check',
        error: error.message
      });
    }
    
    // Test 4: Try GET request to the API
    try {
      const getUrl = 'https://www.wlwv.k12.or.us/site/UserControls/Calendar/CalendarController.aspx/GetEvents?calendarId=3526&startDate=6/1/2025&endDate=6/30/2025';
      const response = await fetch(getUrl);
      const text = await response.text();
      
      results.tests.push({
        name: 'GET Request Test',
        status: response.status,
        responseLength: text.length,
        responsePreview: text.substring(0, 500)
      });
    } catch (error) {
      results.tests.push({
        name: 'GET Request Test',
        error: error.message
      });
    }
    
    // Test 5: Check the export endpoint
    try {
      const exportUrl = 'https://www.wlwv.k12.or.us/site/UserControls/Calendar/EventExportByDateRangeWrapper.aspx';
      const params = new URLSearchParams({
        calendarId: '3526',
        startDate: '6/1/2025',
        endDate: '6/30/2025'
      });
      
      const response = await fetch(`${exportUrl}?${params}`);
      const text = await response.text();
      
      results.tests.push({
        name: 'Export Endpoint Test',
        status: response.status,
        contentType: response.headers.get('content-type'),
        responseLength: text.length,
        responsePreview: text.substring(0, 500),
        isIcal: text.includes('BEGIN:VCALENDAR')
      });
    } catch (error) {
      results.tests.push({
        name: 'Export Endpoint Test',
        error: error.message
      });
    }
    
    return new Response(JSON.stringify(results, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Debug failed',
      details: error.message,
      stack: error.stack
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
