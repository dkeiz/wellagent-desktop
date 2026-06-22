const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const REGISTRY_TYPES = ['skill', 'plugin', 'user', 'project'];

function now() {
  return new Date().toISOString();
}

class WwwGateDb {
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS content_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT 'home',
        sort_order INTEGER NOT NULL DEFAULT 0,
        visible INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        kind TEXT NOT NULL DEFAULT 'link',
        sort_order INTEGER NOT NULL DEFAULT 0,
        visible INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS registry_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT,
        url TEXT,
        owner_name TEXT,
        status TEXT NOT NULL DEFAULT 'published',
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(type, slug)
      );
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending',
        bio TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.seedDefaults();
  }

  seedDefaults() {
    const timestamp = now();
    const content = [
      ['hero', 'LocalAgent', 'Local-first desktop AI agent with multi-chat, tools, plugins, workflows, and companion access.', 'home', 1],
      ['about', 'What it is', 'LocalAgent runs on your machine, connects to local or cloud LLM providers, and keeps conversations, memory, workflows, and knowledge on your disk by default.', 'home', 2],
      ['status', 'Current stage', 'Public beta for release-readiness testing. APIs and plugin contracts are evolving while the desktop, mobile companion, and registry surface mature.', 'home', 3],
      ['webgate', 'Global webgate direction', 'This portal is the public information and registry layer. The registered webgate area is reserved for chosen-user remote workflows and does not replace the local companion gateway.', 'webgate', 1]
    ];
    const insertContent = this.db.prepare(`
      INSERT OR IGNORE INTO content_blocks (block_key, title, body, location, sort_order, visible, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    for (const row of content) insertContent.run(...row, timestamp);

    const links = [
      ['github', 'GitHub repository', 'https://github.com/dkeiz/wellagent-desktop', 'Source, issues, and development history.', 'github', 1],
      ['releases', 'Desktop releases', 'https://github.com/dkeiz/wellagent-desktop/releases/latest', 'Latest full desktop builds from GitHub Releases.', 'download', 1],
      ['wellbot', 'wellbot npm CLI', 'https://www.npmjs.com/package/wellbot', 'Compact CLI for release links and source expansion.', 'download', 2],
      ['docs', 'Project documentation', 'https://github.com/dkeiz/wellagent-desktop#readme', 'README, companion guide, development notes, and publishing docs.', 'docs', 3]
    ];
    const insertLink = this.db.prepare(`
      INSERT OR IGNORE INTO links (link_key, title, url, description, kind, sort_order, visible, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const row of links) insertLink.run(...row, timestamp);

    const registry = [
      ['skill', 'searxng-plugin', 'SearXNG Plugin Skill', 'Workflow notes for search plugin setup and testing.', 'Bundled skill guidance for search integration work.', '', 'LocalAgent', 1],
      ['plugin', 'http-tts-bridge', 'HTTP TTS Bridge', 'Plugin bridge for voice synthesis backends.', 'Ships as a bundled LocalAgent plugin with backend routing.', '', 'LocalAgent', 2],
      ['plugin', 'telegram-relay', 'Telegram Relay', 'Telegram integration plugin for chat relay experiments.', 'Bundled plugin entry for Telegram bot and relay workflows.', '', 'LocalAgent', 3],
      ['project', 'wellagent-desktop', 'LocalAgent Desktop', 'Electron desktop app with local-first agent workflows.', 'The main desktop product distributed through GitHub Releases.', 'https://github.com/dkeiz/wellagent-desktop', 'LocalAgent', 1],
      ['user', 'admin', 'Project Admin', 'Initial admin/community placeholder for chosen-user webgate access.', 'Public profile placeholder. Real webgate access is admin controlled.', '', 'LocalAgent', 1]
    ];
    const insertRegistry = this.db.prepare(`
      INSERT OR IGNORE INTO registry_items
        (type, slug, title, summary, body, url, owner_name, sort_order, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
    `);
    for (const row of registry) insertRegistry.run(...row, timestamp, timestamp);
  }

  close() {
    this.db.close();
  }

  audit(actor, action, targetType, targetId, detail = {}) {
    this.db.prepare(`
      INSERT INTO audit_events (actor, action, target_type, target_id, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(actor, action, targetType || '', String(targetId || ''), JSON.stringify(detail), now());
  }

  content(location = '') {
    const sql = location
      ? 'SELECT * FROM content_blocks WHERE location = ? AND visible = 1 ORDER BY sort_order, id'
      : 'SELECT * FROM content_blocks ORDER BY location, sort_order, id';
    return location ? this.db.prepare(sql).all(location) : this.db.prepare(sql).all();
  }

  links(kind = '') {
    const sql = kind
      ? 'SELECT * FROM links WHERE kind = ? AND visible = 1 ORDER BY sort_order, id'
      : 'SELECT * FROM links ORDER BY kind, sort_order, id';
    return kind ? this.db.prepare(sql).all(kind) : this.db.prepare(sql).all();
  }

  registry(type = '') {
    const sql = type
      ? 'SELECT * FROM registry_items WHERE type = ? AND status = ? ORDER BY sort_order, title'
      : 'SELECT * FROM registry_items WHERE status = ? ORDER BY type, sort_order, title';
    return type ? this.db.prepare(sql).all(type, 'published') : this.db.prepare(sql).all('published');
  }

  allRegistry() {
    return this.db.prepare('SELECT * FROM registry_items ORDER BY type, sort_order, title').all();
  }

  registryItem(type, slug) {
    return this.db.prepare('SELECT * FROM registry_items WHERE type = ? AND slug = ?').get(type, slug);
  }

  users() {
    return this.db.prepare('SELECT id, email, display_name, role, status, bio, created_at, updated_at FROM users ORDER BY created_at DESC').all();
  }

  userByEmail(email) {
    return this.db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
  }

  userById(id) {
    return this.db.prepare('SELECT id, email, display_name, role, status, bio, created_at, updated_at FROM users WHERE id = ?').get(id);
  }

  counts() {
    return {
      content: this.db.prepare('SELECT count(*) AS count FROM content_blocks').get().count,
      links: this.db.prepare('SELECT count(*) AS count FROM links').get().count,
      registry: this.db.prepare('SELECT count(*) AS count FROM registry_items').get().count,
      users: this.db.prepare('SELECT count(*) AS count FROM users').get().count,
      pendingUsers: this.db.prepare("SELECT count(*) AS count FROM users WHERE status = 'pending'").get().count
    };
  }
}

module.exports = { REGISTRY_TYPES, WwwGateDb, now };


