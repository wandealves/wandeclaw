import { GrammyError, type Context } from 'grammy';
import type { AgentReply } from '../agent/AgentController.js';
import { Logger } from '../utils/Logger.js';
import { ErrorOutputStrategy } from './strategies/ErrorOutputStrategy.js';
import { FileOutputStrategy } from './strategies/FileOutputStrategy.js';
import { OutputStrategy } from './strategies/OutputStrategy.js';
import { TextOutputStrategy } from './strategies/TextOutputStrategy.js';

const logger = new Logger('Output');

/**
 * "Boca" do agente: escolhe a estratégia de envio adequada para cada resposta.
 * O retry em 429 (Retry-After) é feito pelo plugin auto-retry configurado no bot.
 */
export class TelegramOutputHandler {
  private readonly text = new TextOutputStrategy();
  private readonly file: FileOutputStrategy;
  private readonly error = new ErrorOutputStrategy();

  constructor(tmpDir: string) {
    this.file = new FileOutputStrategy(tmpDir, this.text);
  }

  async send(ctx: Context, reply: AgentReply): Promise<void> {
    try {
      await this.selectStrategy(reply).send(ctx, reply.text);
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 403) {
        logger.warn('Msg abandonada, User bot-blocked.');
        return;
      }
      logger.error('Falha ao enviar resposta ao Telegram', error);
    }
  }

  private selectStrategy(reply: AgentReply): OutputStrategy {
    if (reply.isError) return this.error;
    if (FileOutputStrategy.hasFiles(reply.text)) return this.file;
    return this.text;
  }
}
