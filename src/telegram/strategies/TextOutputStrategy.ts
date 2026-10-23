import type { Context } from 'grammy';
import { OutputStrategy } from './OutputStrategy.js';

/** Margem abaixo do limite de 4096 caracteres por mensagem do Telegram. */
export const TELEGRAM_CHUNK_LIMIT = 4000;

/**
 * Envia texto puro, fatiando em várias mensagens quando passa do limite.
 */
export class TextOutputStrategy implements OutputStrategy {
  constructor(private readonly limit = TELEGRAM_CHUNK_LIMIT) {}

  async send(ctx: Context, content: string): Promise<void> {
    // for...of sequencial para manter a ordem cronológica dos chunks.
    for (const chunk of TextOutputStrategy.split(content, this.limit)) {
      await ctx.reply(chunk);
    }
  }

  /** Corta preferencialmente em parágrafo, depois linha, depois espaço; nunca no meio de palavra se evitável. */
  static split(text: string, limit = TELEGRAM_CHUNK_LIMIT): string[] {
    const chunks: string[] = [];
    let rest = text.trim();

    while (rest.length > limit) {
      const window = rest.slice(0, limit);
      let cut = window.lastIndexOf('\n\n');
      if (cut < limit * 0.5) cut = window.lastIndexOf('\n');
      if (cut < limit * 0.5) cut = window.lastIndexOf(' ');
      if (cut <= 0) cut = limit;

      chunks.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    if (rest) chunks.push(rest);
    return chunks;
  }
}
