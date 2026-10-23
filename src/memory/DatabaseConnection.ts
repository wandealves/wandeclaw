import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    provider   TEXT NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations (user_id, is_active);

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content         TEXT NOT NULL,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, id);
`;

/**
 * Conexão única (Singleton) com o SQLite. Cria o schema no startup e ativa WAL.
 */
export class DatabaseConnection {
  private static instance: Database.Database | null = null;

  static getInstance(dbPath: string): Database.Database {
    if (!DatabaseConnection.instance) {
      if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 5000');
      db.exec(SCHEMA);
      DatabaseConnection.addMissingColumns(db);
      DatabaseConnection.instance = db;
    }
    return DatabaseConnection.instance;
  }

  /** Bancos criados antes da coluna `metadata` ganham a coluna sem perder dados. */
  private static addMissingColumns(db: Database.Database): void {
    const columns = db.pragma('table_info(messages)') as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'metadata')) {
      db.exec('ALTER TABLE messages ADD COLUMN metadata TEXT');
    }
  }

  static close(): void {
    DatabaseConnection.instance?.close();
    DatabaseConnection.instance = null;
  }
}
