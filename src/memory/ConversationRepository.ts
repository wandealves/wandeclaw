import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface Conversation {
  id: string;
  user_id: string;
  provider: string;
}

export class ConversationRepository {
  constructor(private readonly db: Database.Database) {}

  findActiveByUser(userId: string): Conversation | undefined {
    return this.db
      .prepare(
        'SELECT id, user_id, provider FROM conversations WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1',
      )
      .get(userId) as Conversation | undefined;
  }

  create(userId: string, provider: string): Conversation {
    const conversation: Conversation = { id: randomUUID(), user_id: userId, provider };
    this.db
      .prepare('INSERT INTO conversations (id, user_id, provider) VALUES (@id, @user_id, @provider)')
      .run(conversation);
    return conversation;
  }

  deactivateAllForUser(userId: string): void {
    this.db.prepare('UPDATE conversations SET is_active = 0 WHERE user_id = ?').run(userId);
  }

  touch(id: string): void {
    this.db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(id);
  }
}
