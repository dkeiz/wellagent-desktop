const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Sqlite = require('better-sqlite3');
const { app } = require('electron');
const DatabaseWrapper = require('../src/main/database');
const { migrateDatabase } = require('../src/main/migrate-db');
const { makeTempDir } = require('../tests/helpers/fakes');

function tableColumns(db, tableName) {
  return new Set(
    db.prepare(`PRAGMA table_info("${tableName}")`)
      .all()
      .map(row => row.name)
  );
}

function safeClose(db) {
  if (!db) return;
  try {
    db.close();
  } catch (_) {
  }
}

async function runContract() {
  const tempBase = makeTempDir('localagent-db-migration-');
  const dbPath = path.join(tempBase, 'legacy.db');
  let legacy = null;
  let wrapper = null;

  try {
    legacy = new Sqlite(dbPath);
    legacy.exec(`
      CREATE TABLE conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL
      );
      INSERT INTO conversations (role, content) VALUES ('user', 'legacy message');

      CREATE TABLE workflows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        tool_chain TEXT NOT NULL
      );

      CREATE TABLE chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        created_at DATETIME,
        last_message_at DATETIME
      );
      INSERT INTO chat_sessions (id, title, created_at, last_message_at)
      VALUES (42, 'Todo Session', '2026-05-30 15:00:00', '2026-05-30 15:35:00');

      CREATE TABLE todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        priority INTEGER DEFAULT 1,
        due_date DATETIME,
        created_at DATETIME
      );
      INSERT INTO todos (task, created_at) VALUES
        ('scoped legacy todo', '2026-05-30 15:30:20'),
        ('unmatched legacy todo', '2026-05-29 10:00:00');

      CREATE TABLE daemon_session_inspections (
        session_id TEXT PRIMARY KEY
      );

      CREATE TABLE agent_permission_profiles (
        agent_id INTEGER PRIMARY KEY,
        preset_id TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    safeClose(legacy);
    legacy = null;

    wrapper = new DatabaseWrapper({ dbPath });
    await wrapper.init();

    const migrationRows = wrapper.all('SELECT migration_id FROM schema_migrations ORDER BY migration_id');
    assert.deepStrictEqual(
      migrationRows.map(row => row.migration_id),
      ['0001_core_schema', '0002_legacy_core_columns', '0003_permission_schema', '0004_scheduled_timers', '0005_todo_session_scope', '0006_agent_sidebar_visibility'],
      'Expected all current schema migrations to be recorded'
    );

    for (const column of ['session_id', 'metadata', 'timestamp']) {
      assert.ok(tableColumns(wrapper.db, 'conversations').has(column), `Missing conversations.${column}`);
    }
    for (const column of ['visual_data', 'execution_count', 'success_count', 'failure_count']) {
      assert.ok(tableColumns(wrapper.db, 'workflows').has(column), `Missing workflows.${column}`);
    }
    assert.ok(tableColumns(wrapper.db, 'chat_sessions').has('agent_id'), 'Missing chat_sessions.agent_id');
    assert.ok(tableColumns(wrapper.db, 'todos').has('session_id'), 'Missing todos.session_id');
    assert.ok(tableColumns(wrapper.db, 'agents').has('visible_in_sidebar'), 'Missing agents.visible_in_sidebar');
    assert.ok(tableColumns(wrapper.db, 'daemon_session_inspections').has('notes'), 'Missing daemon_session_inspections.notes');

    const profileColumns = tableColumns(wrapper.db, 'agent_permission_profiles');
    for (const column of ['main_enabled', 'files_mode', 'unsafe_enabled', 'web_enabled', 'terminal_enabled', 'ports_enabled', 'visual_enabled']) {
      assert.ok(profileColumns.has(column), `Missing agent_permission_profiles.${column}`);
    }
    assert.ok(tableColumns(wrapper.db, 'agent_tool_states').has('tool_name'), 'Missing agent_tool_states table');

    const preserved = wrapper.get('SELECT content FROM conversations WHERE role = ?', ['user']);
    assert.strictEqual(preserved.content, 'legacy message', 'Expected legacy rows to survive migration');
    const scopedTodo = wrapper.get('SELECT session_id FROM todos WHERE task = ?', ['scoped legacy todo']);
    const unmatchedTodo = wrapper.get('SELECT session_id FROM todos WHERE task = ?', ['unmatched legacy todo']);
    assert.strictEqual(scopedTodo.session_id, '42', 'Expected matching legacy todo to be assigned to its chat session');
    assert.strictEqual(unmatchedTodo.session_id, null, 'Expected unmatched legacy todo to remain unscoped');
    safeClose(wrapper);
    wrapper = null;

    const repeat = migrateDatabase({ dbPath });
    assert.deepStrictEqual(repeat.applied, [], 'Expected second migration run to be idempotent');
    assert.deepStrictEqual(
      repeat.skipped,
      ['0001_core_schema', '0002_legacy_core_columns', '0003_permission_schema', '0004_scheduled_timers', '0005_todo_session_scope', '0006_agent_sidebar_visibility'],
      'Expected second migration run to skip already recorded migrations'
    );

    assert.ok(fs.existsSync(dbPath), 'Expected migrated database file to remain on disk');
  } finally {
    safeClose(wrapper);
    safeClose(legacy);
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
}

runContract()
  .then(() => {
    console.log('[test-database-migrations] PASS');
    if (app) {
      app.exit(0);
      return;
    }
    process.exit(0);
  })
  .catch(error => {
    console.error('[test-database-migrations] FAIL:', error);
    if (app) {
      app.exit(1);
      return;
    }
    process.exit(1);
  });
