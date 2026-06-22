const ToolPermissionStore = require('../../src/main/tool-permission-store');

class MigrationDb {
  constructor() {
    this.statements = [];
  }

  run(sql) {
    this.statements.push(String(sql).replace(/\s+/g, ' ').trim());
  }
}

module.exports = {
  name: 'tool-permission-store-migration-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = new MigrationDb();
    const store = new ToolPermissionStore(db);

    await store.initialize();

    const alterStatements = db.statements.filter(statement => (
      statement.includes('ALTER TABLE agent_permission_profiles')
      && statement.includes('ADD COLUMN')
    ));

    [
      'main_enabled',
      'preset_id',
      'files_mode',
      'unsafe_enabled',
      'web_enabled',
      'terminal_enabled',
      'terminal_mode',
      'ports_enabled',
      'visual_enabled',
      'created_at',
      'updated_at'
    ].forEach(columnName => {
      assert.ok(
        alterStatements.some(statement => statement.includes(`ADD COLUMN ${columnName} `)),
        `Expected profile migration to add missing ${columnName} column for upgraded databases`
      );
    });

    assert.ok(
      db.statements.some(statement => statement.includes('CREATE TABLE IF NOT EXISTS agent_tool_states')),
      'Expected per-agent tool state table to be created during permission-store initialization'
    );
  }
};
