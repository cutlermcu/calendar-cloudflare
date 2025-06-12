export async function onRequestGet(context) {
  const { env } = context;
  
  try {
    const { results } = await env.DB.prepare(
      'SELECT date, schedule FROM day_schedules ORDER BY date'
    ).all();

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
    const { date, schedule } = body;

    if (!date) {
      return new Response(JSON.stringify({ 
        error: 'Date is required' 
      }), { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (!schedule || schedule === null) {
      await env.DB.prepare('DELETE FROM day_schedules WHERE date = ?').bind(date).run();
    } else {
      if (!['A', 'B'].includes(schedule)) {
        return new Response(JSON.stringify({ 
          error: 'Schedule must be A or B' 
        }), { 
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // Delete then insert for SQLite
      await env.DB.prepare('DELETE FROM day_schedules WHERE date = ?').bind(date).run();
      await env.DB.prepare(
        'INSERT INTO day_schedules (date, schedule) VALUES (?, ?)'
      ).bind(date, schedule).run();
    }

    return new Response(JSON.stringify({ 
      success: true, 
      date, 
      schedule 
    }), {
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

