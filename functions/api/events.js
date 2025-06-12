export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const school = url.searchParams.get('school');
  
  if (!school || !['wlhs', 'wvhs'].includes(school)) {
    return new Response(JSON.stringify({ 
      error: 'Valid school parameter required (wlhs or wvhs)' 
    }), { 
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM events WHERE school = ? ORDER BY date, time, id'
    ).bind(school).all();

    return new Response(JSON.stringify(results), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Database error',
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

export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { school, date, title, department, time, description } = body;

    if (!school || !date || !title) {
      return new Response(JSON.stringify({ 
        error: 'School, date, and title are required' 
      }), { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (!['wlhs', 'wvhs'].includes(school)) {
      return new Response(JSON.stringify({ 
        error: 'School must be wlhs or wvhs' 
      }), { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const stmt = env.DB.prepare(`
      INSERT INTO events (school, date, title, department, time, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(school, date, title, department || null, time || null, description || '');
    
    const result = await stmt.run();
    
    // Get the inserted record
    const newEvent = await env.DB.prepare(
      'SELECT * FROM events WHERE id = ?'
    ).bind(result.meta.last_row_id).first();

    return new Response(JSON.stringify(newEvent), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Database error',
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

// Handle preflight requests
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
