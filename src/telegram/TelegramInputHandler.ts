import path from 'node:path';
import type { Bot, Context, NextFunction } from 'grammy';
import type { AgentController } from '../agent/AgentController.js';
import { DocumentExtractor, DocumentTooLargeError } from '../media/DocumentExtractor.js';
import { ISpeechToText, SpeechToTextUnavailableError } from '../media/SpeechToText.js';
import { Logger, preview } from '../utils/Logger.js';
import { TempFiles } from '../utils/TempFiles.js';
import { AudioReplyDetector } from './AudioReplyDetector.js';
import { TelegramDownloadError, TelegramFileDownloader } from './TelegramFileDownloader.js';
import type { TelegramOutputHandler } from './TelegramOutputHandler.js';

const CHAT_ACTION_INTERVAL_MS = 4500;
/** Limite da Bot API para download de arquivos. */
const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/ogg': '.ogg',
  'audio/opus': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/flac': '.flac',
  'audio/webm': '.webm',
};

const MESSAGES = {
  unsupported: '⚠️ No momento, só consigo processar texto estruturado (.md), áudio e PDF.',
  downloadFailed: '⚠️ Falha ao baixar arquivo do Telegram. Tente novamente.',
  whisperUnavailable: '⚠️ Não consegui inicializar o Whisper local agora.',
  audioFailed: '⚠️ Falha ao processar o áudio: arquivo grande demais ou falha no serviço.',
  emptyAudio: 'Áudio vazio captado. Pode reenviar?',
};

type ChatAction = 'typing' | 'record_voice' | 'upload_document';

export interface MediaServices {
  downloader: TelegramFileDownloader;
  documents: DocumentExtractor;
  speechToText: ISpeechToText;
  tmp: TempFiles;
  maxDocumentBytes: number;
}

const logger = new Logger('Input');

/**
 * Recebe os eventos do Telegram (long polling), aplica a whitelist, converte
 * documentos (PDF/MD) e áudios (Whisper) em texto e repassa ao AgentController.
 */
export class TelegramInputHandler {
  constructor(
    private readonly bot: Bot,
    private readonly allowedUserIds: ReadonlySet<number>,
    private readonly controller: AgentController,
    private readonly output: TelegramOutputHandler,
    private readonly media: MediaServices,
  ) {}

  register(): void {
    // Middleware de topo: quem não está na whitelist é ignorado antes de tocar no DB ou no LLM.
    this.bot.use((ctx, next) => this.whitelist(ctx, next));

    this.bot.command('start', (ctx) =>
      ctx.reply(
        'Olá! Estou online. Mande texto, áudio, PDF ou .md.\n\n/novo — inicia uma nova conversa\n/skills — lista as skills instaladas',
      ),
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

    // Handlers sem await: um download/transcrição longo não bloqueia as demais mensagens (RNF-01).
    this.bot.on('message:text', (ctx) => void this.guard(ctx, () => this.handleText(ctx)));
    this.bot.on('message:document', (ctx) => void this.guard(ctx, () => this.handleDocument(ctx)));
    this.bot.on(['message:voice', 'message:audio'], (ctx) => void this.guard(ctx, () => this.handleAudio(ctx)));
    this.bot.on('message', (ctx) => ctx.reply(MESSAGES.unsupported));
  }

  private async whitelist(ctx: Context, next: NextFunction): Promise<void> {
    const userId = ctx.from?.id;
    if (userId === undefined || !this.allowedUserIds.has(userId)) return;
    await next();
  }

  private async guard(ctx: Context, handler: () => Promise<void>): Promise<void> {
    try {
      await handler();
    } catch (error) {
      logger.error(`Erro ao processar o update ${ctx.update.update_id}`, error);
    }
  }

  private async handleText(ctx: Context): Promise<void> {
    const text = TelegramInputHandler.clean(ctx.message?.text);
    if (!text) return;

    logger.info(`📩 Mensagem de ${ctx.from!.id} (${text.length} caracteres)`);
    await this.process(ctx, text, AudioReplyDetector.detect(text));
  }

  private async handleDocument(ctx: Context): Promise<void> {
    const document = ctx.message!.document!;
    const fileName = document.file_name ?? 'documento';
    const kind = DocumentExtractor.detect(document.file_name, document.mime_type);
    // EC-01: tipo não suportado.
    if (!kind) {
      await ctx.reply(MESSAGES.unsupported);
      return;
    }
    // EC-04: barra antes do download quando o Telegram informa o tamanho.
    if ((document.file_size ?? 0) > this.media.maxDocumentBytes) {
      await ctx.reply(TelegramInputHandler.tooLargeMessage(this.media.maxDocumentBytes));
      return;
    }

    logger.info(`📄 Documento de ${ctx.from!.id}: ${fileName} (${kind})`);
    const stopAction = this.keepChatAction(ctx, 'typing');
    let content: string;
    try {
      content = await this.withDownload(document.file_id, kind === 'pdf' ? '.pdf' : '.md', (filePath) =>
        this.media.documents.extract(filePath, kind),
      );
    } catch (error) {
      stopAction();
      logger.error(`Falha ao processar o documento "${fileName}"`, error);
      if (error instanceof TelegramDownloadError) await ctx.reply(MESSAGES.downloadFailed);
      else if (error instanceof DocumentTooLargeError) await ctx.reply(TelegramInputHandler.tooLargeMessage(this.media.maxDocumentBytes));
      else await ctx.reply(`⚠️ Não consegui ler o documento ${fileName}. Ele pode estar corrompido ou ser grande demais.`);
      return;
    }
    stopAction();

    const caption = TelegramInputHandler.clean(ctx.message?.caption);
    const body = content || '(Não foi possível extrair texto deste documento.)';
    const text = `${caption || 'Analise o documento anexado.'}\n\n<documento nome="${fileName}">\n${body}\n</documento>`;
    await this.process(ctx, text, AudioReplyDetector.detect(caption));
  }

  private async handleAudio(ctx: Context): Promise<void> {
    const message = ctx.message!;
    const media = message.voice ?? message.audio!;
    if ((media.file_size ?? 0) > TELEGRAM_DOWNLOAD_LIMIT) {
      await ctx.reply(MESSAGES.audioFailed);
      return;
    }

    logger.info(`🎙️ Áudio de ${ctx.from!.id} (${media.duration}s)`);
    const stopAction = this.keepChatAction(ctx, 'record_voice');
    let transcript: string;
    try {
      const fileName = message.audio?.file_name;
      transcript = await this.withDownload(media.file_id, TelegramInputHandler.audioExtension(fileName, media.mime_type), (filePath) =>
        this.media.speechToText.transcribe(filePath),
      );
    } catch (error) {
      stopAction();
      logger.error('Falha ao transcrever o áudio', error);
      if (error instanceof TelegramDownloadError) await ctx.reply(MESSAGES.downloadFailed);
      else if (error instanceof SpeechToTextUnavailableError) await ctx.reply(MESSAGES.whisperUnavailable);
      else await ctx.reply(MESSAGES.audioFailed);
      return;
    }
    stopAction();

    transcript = TelegramInputHandler.clean(transcript);
    logger.info(`📝 Transcript: ${preview(transcript)}`);
    // EC-03: áudio mudo não polui o AgentLoop.
    if (!transcript) {
      await ctx.reply(MESSAGES.emptyAudio);
      return;
    }

    const caption = TelegramInputHandler.clean(message.caption);
    // Voice Note pede resposta em voz por padrão (EC-07), salvo negação explícita na legenda.
    await this.process(ctx, caption ? `${caption}\n\n${transcript}` : transcript, !AudioReplyDetector.declined(caption));
  }

  private async process(ctx: Context, text: string, requiresAudioReply: boolean): Promise<void> {
    const stopAction = this.keepChatAction(ctx, requiresAudioReply ? 'record_voice' : 'typing');
    try {
      const reply = await this.controller.handleMessage(String(ctx.from!.id), text, { requiresAudioReply });
      await this.output.send(ctx, reply);
    } finally {
      stopAction();
    }
  }

  /** Baixa o anexo para o tmp, processa e sempre remove o arquivo (RF-03). */
  private async withDownload<T>(fileId: string, extension: string, use: (filePath: string) => Promise<T>): Promise<T> {
    const filePath = await this.media.downloader.download(fileId, extension);
    try {
      return await use(filePath);
    } finally {
      await this.media.tmp.remove(filePath);
    }
  }

  /** Mantém o "digitando..." / "gravando áudio..." ativo até ser interrompido. */
  private keepChatAction(ctx: Context, action: ChatAction): () => void {
    const signal = () => ctx.replyWithChatAction(action).catch(() => undefined);
    void signal();
    const timer = setInterval(signal, CHAT_ACTION_INTERVAL_MS);
    return () => clearInterval(timer);
  }

  private static clean(text: string | undefined): string {
    return (text ?? '').replace(/\u0000/g, '').trim();
  }

  private static audioExtension(fileName: string | undefined, mimeType: string | undefined): string {
    const fromName = path.extname(fileName ?? '').toLowerCase();
    if (/^\.[a-z0-9]{1,5}$/.test(fromName)) return fromName;
    return AUDIO_EXTENSIONS[mimeType ?? ''] ?? '.ogg';
  }

  private static tooLargeMessage(maxBytes: number): string {
    return `⚠️ Documento muito grande. O limite para extração de texto é ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  }
}
