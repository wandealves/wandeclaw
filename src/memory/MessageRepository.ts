import type Database from 'better-sqlite3';
import { Role } from '../llm/types.js';

export interface StoredMessage {
  role: Role;
  content: string;
}

export class MessageRepository {
  constructor(private readonly db: Database.Database) {}

  add(conversationId: string, role: Role, content: string): void {
    this.db
      .prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
      .run(conversationId, role, content);
  }

  /** Últimas `limit` mensagens, em ordem cronológica. */
  findRecent(conversationId: string, limit: number): StoredMessage[] {
    const rows = this.db
      .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
      .all(conversationId, limit) as StoredMessage[];
    return rows.reverse();
  }
}
