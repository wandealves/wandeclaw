import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { LinkedInClient, LinkedInPublishError } from '../linkedin/LinkedInClient.js';
import { LinkedInDraft, LinkedInDrafts } from '../linkedin/LinkedInDrafts.js';
import { Logger } from '../utils/Logger.js';
import { TextOutputStrategy } from './strategies/TextOutputStrategy.js';

/** Limite documentado para posts na UGC API; a doc do Posts API não informa um número. */
export const LINKEDIN_MAX_POST_LENGTH = 3000;

const CALLBACK = /^li:(pub|del):([0-9a-f]+)$/;
const MESSAGES = {
  notConfigured: 'ℹ️ Publicação no LinkedIn não configurada: defina LINKEDIN_ACCESS_TOKEN e LINKEDIN_PERSON_URN no .env.',
  gone: 'Rascunho expirado ou já processado.',
  ambiguous: '⚠️ Não tive confirmação do LinkedIn e o post pode ter saído. Confira seu perfil antes de tentar de novo.',
  unauthorized: '⚠️ O LinkedIn recusou o token, que pode ter vencido. Gere outro, atualize o .env e reinicie o bot.',
  forbidden: '⚠️ O LinkedIn negou a publicação. Confira se o token tem a permissão w_member_social.',
  rateLimited: '⚠️ Limite de publicações do LinkedIn atingido. Tente mais tarde.',
};

const logger = new Logger('LinkedInDrafts');

/**
 * Mostra rascunhos com os botões Publicar/Cancelar e publica sem passar pelo LLM.
 * O texto enviado ao LinkedIn é exatamente o que apareceu no Telegram.
 */
export class LinkedInDraftHandler {
  constructor(
    private readonly drafts: LinkedInDrafts,
    private readonly client: LinkedInClient | null,
  ) {}

  /** Registrar depois da whitelist, para ela valer também nos botões. */
  register(bot: Bot): void {
    bot.callbackQuery(CALLBACK, (ctx) => {
      void this.handleButton(ctx, ctx.match[1], ctx.match[2]).catch((error) =>
        logger.error('Falha ao tratar o botão do rascunho', error),
      );
    });
  }

  async send(ctx: Context, texts: string[]): Promise<void> {
    for (const text of texts) await this.sendDraft(ctx, text);
  }

  private async sendDraft(ctx: Context, text: string): Promise<void> {
    if (this.client && text.length <= LINKEDIN_MAX_POST_LENGTH) {
      const id = this.drafts.add(String(ctx.from!.id), text);
      await ctx.reply(text, { reply_markup: LinkedInDraftHandler.keyboard(id) });
      return;
    }

    await new TextOutputStrategy().send(ctx, text);
    await ctx.reply(
      this.client
        ? `⚠️ O post tem ${text.length} caracteres e o limite é ${LINKEDIN_MAX_POST_LENGTH}. Peça uma versão mais curta para poder publicar.`
        : MESSAGES.notConfigured,
    );
  }

  private async handleButton(ctx: Context, action: string, id: string): Promise<void> {
    const draft = this.drafts.take(id, String(ctx.from!.id));
    if (!draft) {
      await ctx.answerCallbackQuery({ text: MESSAGES.gone });
      return;
    }

    if (action === 'del') {
      await ctx.answerCallbackQuery({ text: 'Rascunho cancelado.' });
      await ctx.editMessageReplyMarkup();
      return;
    }

    await ctx.answerCallbackQuery({ text: 'Publicando...' });
    await ctx.editMessageReplyMarkup();
    await this.publish(ctx, draft);
  }

  private async publish(ctx: Context, draft: LinkedInDraft): Promise<void> {
    let url: string | null;
    try {
      if (!this.client) throw new LinkedInPublishError('LinkedIn não configurado.', 'rejected');
      url = await this.client.publish(draft.text);
    } catch (error) {
      await this.reportFailure(ctx, draft, error);
      return;
    }
    await ctx.reply(url ? `✅ Publicado no LinkedIn: ${url}` : '✅ Publicado no LinkedIn.');
  }

  private async reportFailure(ctx: Context, draft: LinkedInDraft, error: unknown): Promise<void> {
    if (!(error instanceof LinkedInPublishError) || error.kind === 'ambiguous') {
      logger.error('Resultado da publicação desconhecido', error);
      await ctx.reply(MESSAGES.ambiguous);
      return;
    }

    // Recusa explícita: nada foi publicado, então o mesmo botão pode ser usado de novo.
    this.drafts.restore(draft);
    await ctx.editMessageReplyMarkup({ reply_markup: LinkedInDraftHandler.keyboard(draft.id) });
    await ctx.reply(LinkedInDraftHandler.describeRejection(error));
  }

  private static describeRejection(error: LinkedInPublishError): string {
    if (error.status === 401) return MESSAGES.unauthorized;
    if (error.status === 403) return MESSAGES.forbidden;
    if (error.status === 429) return MESSAGES.rateLimited;
    return `⚠️ Não publiquei: ${error.message}`;
  }

  private static keyboard(id: string): InlineKeyboard {
    return new InlineKeyboard().text('✅ Publicar', `li:pub:${id}`).text('❌ Cancelar', `li:del:${id}`);
  }
}
