import fs from 'node:fs/promises';
import { GrammyError, InputFile, type Context } from 'grammy';
import { AudioConverter } from '../../media/AudioConverter.js';
import { ITextToSpeech } from '../../media/TextToSpeech.js';
import { Logger } from '../../utils/Logger.js';
import { TempFiles } from '../../utils/TempFiles.js';
import { FileOutputStrategy } from './FileOutputStrategy.js';
import { OutputStrategy } from './OutputStrategy.js';
import { TextOutputStrategy } from './TextOutputStrategy.js';

const logger = new Logger('AudioOutput');

/**
 * Sintetiza a resposta em voz (Edge-TTS → OGG/Opus) e envia como Voice Note.
 * Blocos `<arquivo>` continuam indo como documento. Se o TTS falhar, cai para texto.
 */
export class AudioOutputStrategy implements OutputStrategy {
  constructor(
    private readonly tts: ITextToSpeech,
    private readonly converter: AudioConverter,
    private readonly tmp: TempFiles,
    private readonly text: TextOutputStrategy,
    private readonly file: FileOutputStrategy,
  ) {}

  async send(ctx: Context, content: string): Promise<void> {
    const { files, remainder } = FileOutputStrategy.extract(content);
    const speech = AudioOutputStrategy.toSpeech(remainder);

    if (speech) {
      try {
        await this.sendVoice(ctx, speech);
      } catch (error) {
        if (error instanceof GrammyError && error.error_code === 403) throw error;
        logger.error('Falha ao gerar/enviar áudio; enviando como texto', error);
        await this.text.send(ctx, `⚠️ Não consegui gerar o áudio, segue em texto:\n\n${remainder}`);
      }
    }
    await this.file.sendFiles(ctx, files);
  }

  private async sendVoice(ctx: Context, speech: string): Promise<void> {
    await ctx.replyWithChatAction('record_voice').catch(() => undefined);
    const mp3Path = await this.tmp.newPath('.mp3');
    const oggPath = await this.tmp.newPath('.ogg');
    try {
      await fs.writeFile(mp3Path, await this.tts.synthesize(speech));
      await this.converter.toOggOpus(mp3Path, oggPath);
      await ctx.replyWithVoice(new InputFile(oggPath, 'resposta.ogg'));
      logger.info(`🔊 Resposta enviada em áudio (${speech.length} caracteres).`);
    } finally {
      await this.tmp.remove(mp3Path, oggPath);
    }
  }

  /** Remove a marcação Markdown para o TTS não "ler" símbolos. */
  static toSpeech(markdown: string): string {
    return markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
      .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
      .replace(/\|/g, ', ')
      .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
      .replace(/(^|[\s(])[*_]([^*_\n]+)[*_]/g, '$1$2')
      .replace(/[ \t]+/g, ' ')
      .replace(/^ | $/gm, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }
}
