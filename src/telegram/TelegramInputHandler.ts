import type { Bot, Context, NextFunction } from 'grammy';
import type { AgentController } from '../agent/AgentController.js';
import { Logger } from '../utils/Logger.js';
import type { TelegramOutputHandler } from './TelegramOutputHandler.js';

const TYPING_INTERVAL_MS = 4500;
const logger = new Logger('Input');

/**
 * Recebe os eventos do Telegram (long polling), aplica a whitelist e repassa
 * o texto ao AgentController.
 */
export class TelegramInputHandler {
  constructor(
    private readonly bot: Bot,
    private readonly allowedUserIds: ReadonlySet<number>,
    private readonly controller: AgentController,
    private readonly output: TelegramOutputHandler,
  ) {}

  register(): void {
    // Middleware de topo: quem não está na whitelist é ignorado antes de tocar no DB ou no LLM.
    this.bot.use((ctx, next) => this.whitelist(ctx, next));

    this.bot.command('start', (ctx) =>
      ctx.reply('Olá! Estou online. Mande sua mensagem.\n\n/novo — inicia uma nova conversa\n/skills — lista as skills instaladas'),
    );
    this.bot.command('novo', async (ctx) => {
      this.controller.startNewConversation(String(ctx.from!.id));
      await ctx.reply('🧹 Nova conversa iniciada. O histórico anterior continua salvo, mas fora do contexto.');
    });
    this.bot.command('skills', async (ctx) => {
      const skills = this.controller.listSkills();
      await ctx.reply(
        skills.length
          ? `Skills instaladas:\n\n${skills.map((skill) => `• ${skill.name} — ${skill.description}`).join('\n')}`
          : 'Nenhuma skill instalada em .agents/skills.',
      );
    });

    this.bot.on('message:text', (ctx) => this.handleText(ctx));
    this.bot.on('message', (ctx) => ctx.reply('⚠️ No momento, só consigo processar mensagens de texto.'));
  }

  private async whitelist(ctx: Context, next: NextFunction): Promise<void> {
    const userId = ctx.from?.id;
    if (userId === undefined || !this.allowedUserIds.has(userId)) return;
    await next();
  }

  private async handleText(ctx: Context): Promise<void> {
    const userId = String(ctx.from!.id);
    const text = (ctx.message?.text ?? '').replace(/\u0000/g, '').trim();
    if (!text) return;

    logger.info(`📩 Mensagem de ${userId} (${text.length} caracteres)`);
    const stopTyping = this.keepTyping(ctx);
    try {
      const reply = await this.controller.handleMessage(userId, text);
      await this.output.send(ctx, reply);
    } finally {
      stopTyping();
    }
  }

  /** Mantém o "digitando..." ativo até a resposta ser enviada. */
  private keepTyping(ctx: Context): () => void {
    const signal = () => ctx.replyWithChatAction('typing').catch(() => undefined);
    void signal();
    const timer = setInterval(signal, TYPING_INTERVAL_MS);
    return () => clearInterval(timer);
  }
}
