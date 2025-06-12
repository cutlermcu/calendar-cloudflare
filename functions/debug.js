cat > functions/api/debug.js << 'EOF'
export async function onRequest(context) {
  const { env, request } = context;
  
  try {
    // Check what we have access to
    const debug = {
      hasDB: !!env.DB,
      envKeys: Object.keys(env),
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries())
    };

    // Try to test DB if available
    if (env.DB) {
      try {
        const result = await env.DB.prepare('SELECT 1 as test').first();
        debug.dbTest = result;
        debug.dbStatus = 'connected';
      } catch (dbError) {
        debug.dbError = dbError.message;
        debug.dbStatus = 'error';
      }
    } else {
      debug.dbStatus = 'not bound';
    }

    return new Response(JSON.stringify(debug, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
      stack: error.stack
    }, null, 2), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
EOF

# Commit and push
git add functions/api/debug.js
git commit -m "Add debug function"
git push
