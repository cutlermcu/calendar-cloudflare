export async function onRequestPost(context) {
  const { env } = context;
  
  try {
    // Tables should already exist from D1 schema, but we'll ensure they're there
    const tables = [
      `CREATE TABLE IF NOT EXISTS day_schedules (
        date TEXT PRIMARY KEY,
        schedule TEXT CHECK(schedule IN ('A', 'B')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS day_types (
        date TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school TEXT CHECK(school IN ('wlhs', 'wvhs')),
        date TEXT NOT NULL,
        title TEXT NOT NULL,
        department TEXT,
        time TEXT,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school TEXT CHECK(school IN ('wlhs', 'wvhs')),
        date TEXT NOT NULL,
        grade_level INTEGER CHECK(grade_level BETWEEN 9 AND 12),
        title TEXT NOT NULL,
        link TEXT NOT NULL,
        description TEXT DEFAULT '',
        password TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      await env.DB.prepare(sql).run();
    }

    return new Response(JSON.stringify({ 
      message: 'Database initialized successfully',
      tables: ['day_schedules', 'day_types', 'events', 'materials']
    }), { 
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Failed to initialize database',
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
