import type { Context } from 'grammy';
import { OutputStrategy } from './OutputStrategy.js';

export class ErrorOutputStrategy implements OutputStrategy {
  async send(ctx: Context, content: string): Promise<void> {
    await ctx.reply(`⚠️ Erro: ${content}`);
  }
}
