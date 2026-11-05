import { randomBytes } from 'node:crypto';

const DRAFT_BLOCK = /<linkedin-post>([\s\S]*?)<\/linkedin-post>/g;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface LinkedInDraft {
  id: string;
  userId: string;
  text: string;
  createdAt: number;
}

/**
 * Rascunhos aguardando decisão do usuário. Ficam só em memória: depois de um
 * reinício os botões antigos expiram e nada é publicado.
 */
export class LinkedInDrafts {
  private readonly drafts = new Map<string, LinkedInDraft>();

  constructor(private readonly now: () => number = Date.now) {}

  static extract(content: string): { drafts: string[]; remainder: string } {
    const drafts = [...content.matchAll(DRAFT_BLOCK)].map((match) => match[1].trim()).filter(Boolean);
    const remainder = content.replace(DRAFT_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim();
    return { drafts, remainder };
  }

  add(userId: string, text: string): string {
    this.purgeExpired();
    const id = randomBytes(6).toString('hex');
    this.drafts.set(id, { id, userId, text, createdAt: this.now() });
    return id;
  }

  /** Retira o rascunho: um duplo clique encontra `null` e não publica duas vezes. */
  take(id: string, userId: string): LinkedInDraft | null {
    const draft = this.drafts.get(id);
    if (!draft || draft.userId !== userId) return null;
    this.drafts.delete(id);
    return this.isExpired(draft) ? null : draft;
  }

  restore(draft: LinkedInDraft): void {
    this.drafts.set(draft.id, draft);
  }

  private isExpired(draft: LinkedInDraft): boolean {
    return this.now() - draft.createdAt > DRAFT_TTL_MS;
  }

  private purgeExpired(): void {
    for (const draft of this.drafts.values()) {
      if (this.isExpired(draft)) this.drafts.delete(draft.id);
    }
  }
}
