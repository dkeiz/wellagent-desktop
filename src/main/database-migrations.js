const DEFAULT_AGENT_ICON = '\u{1F916}';

const CORE_TABLES = [
    `CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        start_time DATETIME NOT NULL,
        duration_minutes INTEGER DEFAULT 60,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        priority INTEGER DEFAULT 1,
        due_date DATETIME,
        session_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS api_keys (
        provider TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        encrypted BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS prompt_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        active BOOLEAN DEFAULT FALSE,
        type TEXT DEFAULT 'rule',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        agent_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS custom_tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        code TEXT NOT NULL,
        input_schema TEXT,
        active BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS scheduled_timers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timer_id TEXT NOT NULL,
        context_key TEXT NOT NULL,
        context_json TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        due_at DATETIME,
        interval_ms INTEGER NOT NULL,
        remaining_ms INTEGER,
        repeat INTEGER NOT NULL DEFAULT 0,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paused_at DATETIME,
        fired_at DATETIME,
        last_error TEXT,
        UNIQUE(timer_id, context_key)
    )`,
    `CREATE TABLE IF NOT EXISTS workflows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        trigger_pattern TEXT,
        tool_chain TEXT NOT NULL,
        embedding TEXT,
        visual_data TEXT,
        execution_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        last_used DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'pro',
        icon TEXT DEFAULT '${DEFAULT_AGENT_ICON}',
        system_prompt TEXT,
        description TEXT,
        status TEXT DEFAULT 'idle',
        visible_in_sidebar INTEGER NOT NULL DEFAULT 1,
        config TEXT,
        folder_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subagent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_session_id TEXT,
        child_session_id TEXT NOT NULL,
        subagent_id INTEGER NOT NULL,
        task TEXT NOT NULL,
        contract_type TEXT NOT NULL DEFAULT 'task_complete',
        expected_output TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        result_summary TEXT,
        result_payload TEXT,
        artifacts_json TEXT,
        runtime_policy_profile TEXT DEFAULT 'strict-subagent',
        runtime_policy_grants_json TEXT,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (subagent_id) REFERENCES agents(id),
        FOREIGN KEY (parent_session_id) REFERENCES chat_sessions(id),
        FOREIGN KEY (child_session_id) REFERENCES chat_sessions(id)
    )`,
    `CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'disabled',
        visible_in_sidebar INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        status TEXT DEFAULT 'staged',
        tags TEXT,
        source TEXT,
        confidence REAL DEFAULT 0.5,
        folder_path TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        confirmed_at DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS memory_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        locked_at DATETIME,
        locked_by TEXT,
        payload_json TEXT,
        result_summary TEXT,
        last_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS daemon_session_inspections (
        session_id TEXT PRIMARY KEY,
        inspector TEXT NOT NULL DEFAULT 'memory-daemon',
        inspected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        job_id INTEGER,
        notes TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS tool_states (
        tool_name TEXT PRIMARY KEY,
        active BOOLEAN DEFAULT TRUE,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
];

const INDEXES = [
    `CREATE INDEX IF NOT EXISTS idx_memory_jobs_schedule
        ON memory_jobs (job_type, status, next_run_at, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_memory_jobs_session
        ON memory_jobs (job_type, session_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_daemon_session_inspections_time
        ON daemon_session_inspections (inspected_at)`
];

const LEGACY_COLUMNS = {
    todos: [
        ['session_id', 'TEXT']
    ],
    conversations: [
        ['session_id', 'TEXT'],
        ['metadata', 'TEXT'],
        ['timestamp', 'DATETIME']
    ],
    workflows: [
        ['description', 'TEXT'],
        ['trigger_pattern', 'TEXT'],
        ['embedding', 'TEXT'],
        ['visual_data', 'TEXT'],
        ['execution_count', 'INTEGER DEFAULT 0'],
        ['success_count', 'INTEGER DEFAULT 0'],
        ['failure_count', 'INTEGER DEFAULT 0'],
        ['last_used', 'DATETIME'],
        ['created_at', 'DATETIME']
    ],
    chat_sessions: [
        ['agent_id', 'INTEGER'],
        ['created_at', 'DATETIME'],
        ['last_message_at', 'DATETIME']
    ],
    daemon_session_inspections: [
        ['inspector', "TEXT NOT NULL DEFAULT 'memory-daemon'"],
        ['inspected_at', 'DATETIME'],
        ['job_id', 'INTEGER'],
        ['notes', 'TEXT']
    ],
    api_keys: [
        ['encrypted', 'BOOLEAN DEFAULT FALSE'],
        ['created_at', 'DATETIME']
    ],
    prompt_rules: [
        ['active', 'BOOLEAN DEFAULT FALSE'],
        ['type', "TEXT DEFAULT 'rule'"],
        ['created_at', 'DATETIME'],
        ['updated_at', 'DATETIME']
    ],
    custom_tools: [
        ['input_schema', 'TEXT'],
        ['active', 'BOOLEAN DEFAULT FALSE'],
        ['created_at', 'DATETIME']
    ],
    scheduled_timers: [
        ['timer_id', 'TEXT'],
        ['context_key', 'TEXT'],
        ['context_json', 'TEXT'],
        ['status', "TEXT NOT NULL DEFAULT 'active'"],
        ['due_at', 'DATETIME'],
        ['interval_ms', 'INTEGER NOT NULL DEFAULT 0'],
        ['remaining_ms', 'INTEGER'],
        ['repeat', 'INTEGER NOT NULL DEFAULT 0'],
        ['message', 'TEXT'],
        ['created_at', 'DATETIME'],
        ['updated_at', 'DATETIME'],
        ['paused_at', 'DATETIME'],
        ['fired_at', 'DATETIME'],
        ['last_error', 'TEXT']
    ],
    agents: [
        ['type', "TEXT NOT NULL DEFAULT 'pro'"],
        ['icon', `TEXT DEFAULT '${DEFAULT_AGENT_ICON}'`],
        ['system_prompt', 'TEXT'],
        ['description', 'TEXT'],
        ['status', "TEXT DEFAULT 'idle'"],
        ['visible_in_sidebar', 'INTEGER NOT NULL DEFAULT 1'],
        ['config', 'TEXT'],
        ['folder_path', 'TEXT'],
        ['created_at', 'DATETIME'],
        ['updated_at', 'DATETIME']
    ],
    subagent_runs: [
        ['parent_session_id', 'TEXT'],
        ['contract_type', "TEXT NOT NULL DEFAULT 'task_complete'"],
        ['expected_output', 'TEXT'],
        ['status', "TEXT NOT NULL DEFAULT 'running'"],
        ['result_summary', 'TEXT'],
        ['result_payload', 'TEXT'],
        ['artifacts_json', 'TEXT'],
        ['runtime_policy_profile', "TEXT DEFAULT 'strict-subagent'"],
        ['runtime_policy_grants_json', 'TEXT'],
        ['error', 'TEXT'],
        ['created_at', 'DATETIME'],
        ['completed_at', 'DATETIME']
    ],
    plugins: [
        ['status', "TEXT NOT NULL DEFAULT 'disabled'"],
        ['visible_in_sidebar', 'INTEGER NOT NULL DEFAULT 1'],
        ['error', 'TEXT'],
        ['installed_at', 'DATETIME'],
        ['updated_at', 'DATETIME']
    ],
    knowledge_items: [
        ['category', "TEXT DEFAULT 'general'"],
        ['status', "TEXT DEFAULT 'staged'"],
        ['tags', 'TEXT'],
        ['source', 'TEXT'],
        ['confidence', 'REAL DEFAULT 0.5'],
        ['folder_path', "TEXT NOT NULL DEFAULT ''"],
        ['created_at', 'DATETIME'],
        ['updated_at', 'DATETIME'],
        ['confirmed_at', 'DATETIME']
    ],
    memory_jobs: [
        ['status', "TEXT NOT NULL DEFAULT 'pending'"],
        ['attempts', 'INTEGER NOT NULL DEFAULT 0'],
        ['next_run_at', 'DATETIME'],
        ['locked_at', 'DATETIME'],
        ['locked_by', 'TEXT'],
        ['payload_json', 'TEXT'],
        ['result_summary', 'TEXT'],
        ['last_error', 'TEXT'],
        ['created_at', 'DATETIME'],
        ['updated_at', 'DATETIME']
    ],
    tool_states: [
        ['active', 'BOOLEAN DEFAULT TRUE'],
        ['updated_at', 'DATETIME']
    ]
};

function quoteIdentifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

function tableExists(db, tableName) {
    return Boolean(db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(tableName));
}

function getColumns(db, tableName) {
    if (!tableExists(db, tableName)) {
        return new Set();
    }
    return new Set(
        db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
            .all()
            .map(row => row.name)
    );
}

function addColumnIfMissing(db, tableName, columnName, definition) {
    const columns = getColumns(db, tableName);
    if (columns.has(columnName)) {
        return false;
    }
    db.exec(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`);
    return true;
}

function ensureLegacyColumns(db) {
    for (const [tableName, columns] of Object.entries(LEGACY_COLUMNS)) {
        if (!tableExists(db, tableName)) {
            continue;
        }
        for (const [columnName, definition] of columns) {
            addColumnIfMissing(db, tableName, columnName, definition);
        }
    }
}

function ensurePermissionSchema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS agent_permission_profiles (
        agent_id INTEGER PRIMARY KEY,
        main_enabled INTEGER NOT NULL DEFAULT 1,
        preset_id TEXT NOT NULL DEFAULT '',
        files_mode TEXT NOT NULL DEFAULT 'read',
        unsafe_enabled INTEGER NOT NULL DEFAULT 0,
        web_enabled INTEGER NOT NULL DEFAULT 1,
        terminal_enabled INTEGER NOT NULL DEFAULT 1,
        terminal_mode TEXT NOT NULL DEFAULT 'workspace',
        ports_enabled INTEGER NOT NULL DEFAULT 1,
        visual_enabled INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    const profileColumns = [
        ['main_enabled', 'INTEGER NOT NULL DEFAULT 1'],
        ['preset_id', "TEXT NOT NULL DEFAULT ''"],
        ['files_mode', "TEXT NOT NULL DEFAULT 'read'"],
        ['unsafe_enabled', 'INTEGER NOT NULL DEFAULT 0'],
        ['web_enabled', 'INTEGER NOT NULL DEFAULT 1'],
        ['terminal_enabled', 'INTEGER NOT NULL DEFAULT 1'],
        ['terminal_mode', "TEXT NOT NULL DEFAULT 'workspace'"],
        ['ports_enabled', 'INTEGER NOT NULL DEFAULT 1'],
        ['visual_enabled', 'INTEGER NOT NULL DEFAULT 0'],
        ['created_at', 'DATETIME'],
        ['updated_at', 'DATETIME']
    ];
    for (const [columnName, definition] of profileColumns) {
        addColumnIfMissing(db, 'agent_permission_profiles', columnName, definition);
    }

    db.exec(`CREATE TABLE IF NOT EXISTS agent_tool_states (
        agent_id INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        active INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (agent_id, tool_name)
    )`);
}

function ensureTodoSessionScope(db) {
    if (!tableExists(db, 'todos')) return;
    addColumnIfMissing(db, 'todos', 'session_id', 'TEXT');

    if (tableExists(db, 'chat_sessions')) {
        db.exec(`
            UPDATE todos
            SET session_id = (
                SELECT CAST(cs.id AS TEXT)
                FROM chat_sessions cs
                WHERE todos.created_at IS NOT NULL
                  AND cs.created_at IS NOT NULL
                  AND datetime(todos.created_at) >= datetime(cs.created_at, '-2 seconds')
                  AND datetime(todos.created_at) <= datetime(COALESCE(cs.last_message_at, cs.created_at), '+5 minutes')
                ORDER BY datetime(COALESCE(cs.last_message_at, cs.created_at)) ASC,
                         datetime(cs.created_at) DESC
                LIMIT 1
            )
            WHERE (session_id IS NULL OR session_id = '')
              AND EXISTS (
                SELECT 1
                FROM chat_sessions cs
                WHERE todos.created_at IS NOT NULL
                  AND cs.created_at IS NOT NULL
                  AND datetime(todos.created_at) >= datetime(cs.created_at, '-2 seconds')
                  AND datetime(todos.created_at) <= datetime(COALESCE(cs.last_message_at, cs.created_at), '+5 minutes')
              )
        `);
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_todos_session_created ON todos (session_id, created_at)');
}

function ensureAgentSidebarVisibility(db) {
    if (!tableExists(db, 'agents')) return;
    addColumnIfMissing(db, 'agents', 'visible_in_sidebar', 'INTEGER NOT NULL DEFAULT 1');
}

const MIGRATIONS = [
    {
        id: '0001_core_schema',
        description: 'Create current core tables and indexes',
        up(db) {
            for (const query of CORE_TABLES) {
                db.exec(query);
            }
        }
    },
    {
        id: '0002_legacy_core_columns',
        description: 'Patch legacy tables with columns added after first release',
        up(db) {
            ensureLegacyColumns(db);
            for (const query of INDEXES) {
                db.exec(query);
            }
        }
    },
    {
        id: '0003_permission_schema',
        description: 'Create and patch per-agent tool permission tables',
        up(db) {
            ensurePermissionSchema(db);
        }
    },
    {
        id: '0004_scheduled_timers',
        description: 'Create persistent backend timer table',
        up(db) {
            db.exec(CORE_TABLES.find(query => query.includes('scheduled_timers')));
        }
    },
    {
        id: '0005_todo_session_scope',
        description: 'Scope todo rows to chat sessions',
        up(db) {
            ensureTodoSessionScope(db);
        }
    },
    {
        id: '0006_agent_sidebar_visibility',
        description: 'Allow agents to be hidden from sidebar lists',
        up(db) {
            ensureAgentSidebarVisibility(db);
        }
    }
];

function ensureMigrationTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id TEXT PRIMARY KEY,
        description TEXT,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

function runDatabaseMigrations(db) {
    ensureMigrationTable(db);
    const applied = new Set(
        db.prepare('SELECT migration_id FROM schema_migrations')
            .all()
            .map(row => row.migration_id)
    );
    const result = { applied: [], skipped: [] };

    for (const migration of MIGRATIONS) {
        if (applied.has(migration.id)) {
            result.skipped.push(migration.id);
            continue;
        }
        const run = db.transaction(() => {
            migration.up(db);
            db.prepare(
                'INSERT OR REPLACE INTO schema_migrations (migration_id, description) VALUES (?, ?)'
            ).run(migration.id, migration.description);
        });
        run();
        result.applied.push(migration.id);
    }

    return result;
}

module.exports = {
    MIGRATIONS,
    addColumnIfMissing,
    ensureLegacyColumns,
    ensurePermissionSchema,
    ensureAgentSidebarVisibility,
    ensureTodoSessionScope,
    runDatabaseMigrations
};
