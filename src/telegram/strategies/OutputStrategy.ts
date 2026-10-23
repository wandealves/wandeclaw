import type { Context } from 'grammy';

/**
 * Estratégia de envio de uma resposta ao chat do Telegram.
 */
export interface OutputStrategy {
  send(ctx: Context, content: string): Promise<void>;
}
