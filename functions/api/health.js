export async function onRequest(context) {
  const { env } = context;
  
  try {
    // Test D1 connection
    const result = await env.DB.prepare('SELECT 1 as test').first();
    
    return new Response(JSON.stringify({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      test: result
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
