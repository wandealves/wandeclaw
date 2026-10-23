import type Database from 'better-sqlite3';
import { Role } from '../llm/types.js';

export type MessageMetadata = Record<string, unknown>;

export interface StoredMessage {
  role: Role;
  content: string;
}

export class MessageRepository {
  constructor(private readonly db: Database.Database) {}

  add(conversationId: string, role: Role, content: string, metadata?: MessageMetadata): void {
    this.db
      .prepare('INSERT INTO messages (conversation_id, role, content, metadata) VALUES (?, ?, ?, ?)')
      .run(conversationId, role, content, metadata ? JSON.stringify(metadata) : null);
  }

  /** Últimas `limit` mensagens com os papéis informados, em ordem cronológica. */
  findRecent(conversationId: string, limit: number, roles: Role[]): StoredMessage[] {
    const placeholders = roles.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT role, content FROM messages WHERE conversation_id = ? AND role IN (${placeholders}) ORDER BY id DESC LIMIT ?`,
      )
      .all(conversationId, ...roles, limit) as StoredMessage[];
    return rows.reverse();
  }
}
