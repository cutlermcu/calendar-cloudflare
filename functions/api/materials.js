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
      'SELECT * FROM materials WHERE school = ? ORDER BY date, grade_level, id'
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
    const { school, date, grade_level, title, link, description, password } = body;

    if (!school || !date || !grade_level || !title || !link) {
      return new Response(JSON.stringify({ 
        error: 'School, date, grade_level, title, and link are required' 
      }), { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const stmt = env.DB.prepare(`
      INSERT INTO materials (school, date, grade_level, title, link, description, password)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(school, date, grade_level, title, link, description || '', password || '');
    
    const result = await stmt.run();
    
    const newMaterial = await env.DB.prepare(
      'SELECT * FROM materials WHERE id = ?'
    ).bind(result.meta.last_row_id).first();

    return new Response(JSON.stringify(newMaterial), {
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

export async function onRequestDelete(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();
  
  try {
    await env.DB.prepare('DELETE FROM materials WHERE id = ?').bind(id).run();
    
    return new Response(JSON.stringify({ success: true }), {
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

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
