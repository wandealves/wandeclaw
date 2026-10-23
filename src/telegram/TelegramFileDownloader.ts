import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import type { Api } from 'grammy';
import { TempFiles } from '../utils/TempFiles.js';

/** Sem bytes recebidos por este tempo, o download é abortado (EC-05). */
const IDLE_TIMEOUT_MS = 15_000;

export class TelegramDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramDownloadError';
  }
}

/**
 * Baixa anexos do Telegram para o `./tmp`. Em qualquer falha o arquivo parcial é removido.
 */
export class TelegramFileDownloader {
  constructor(
    private readonly api: Api,
    private readonly token: string,
    private readonly tmp: TempFiles,
    private readonly idleTimeoutMs = IDLE_TIMEOUT_MS,
  ) {}

  async download(fileId: string, extension: string): Promise<string> {
    const target = await this.tmp.newPath(extension);
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), this.idleTimeoutMs);
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), this.idleTimeoutMs);
    };

    try {
      const file = await this.api.getFile(fileId, controller.signal as Parameters<Api['getFile']>[1]);
      if (!file.file_path) throw new Error('Telegram não informou o caminho do arquivo.');

      const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const watchdog = new Transform({
        transform(chunk, _encoding, callback) {
          resetTimer();
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body as ReadableStream), watchdog, fs.createWriteStream(target), {
        signal: controller.signal,
      });
      return target;
    } catch (error) {
      await this.tmp.remove(target);
      const reason = controller.signal.aborted
        ? `nenhum byte recebido em ${this.idleTimeoutMs / 1000}s`
        : this.redact(error instanceof Error ? error.message : String(error));
      throw new TelegramDownloadError(`Falha ao baixar arquivo do Telegram: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** O token do bot faz parte da URL de download; nunca deve ir para logs. */
  private redact(message: string): string {
    return message.split(this.token).join('<token>');
  }
}
