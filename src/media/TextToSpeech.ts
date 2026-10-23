import fs from 'node:fs/promises';
import path from 'node:path';
import { Communicate } from 'edge-tts-universal';
import { Config } from '../config/Config.js';
import { runProcess } from '../utils/Process.js';
import { TempFiles } from '../utils/TempFiles.js';

const CONNECTION_TIMEOUT_MS = 15_000;

/**
 * Contrato de síntese de voz (TTS). Retorna o áudio em MP3.
 */
export interface ITextToSpeech {
  synthesize(text: string): Promise<Buffer>;
}

/**
 * TTS via CLI oficial do edge-tts (`pip install edge-tts`), que acompanha as
 * mudanças de autenticação do serviço da Microsoft.
 */
export class EdgeTtsCliTextToSpeech implements ITextToSpeech {
  constructor(
    private readonly command: string,
    private readonly voice: string,
    private readonly timeoutMs: number,
    private readonly tmp: TempFiles,
  ) {}

  async synthesize(text: string): Promise<Buffer> {
    const workDir = await this.tmp.newDir('tts');
    try {
      // Texto via arquivo: evita limite de tamanho de argumentos (principalmente no Windows).
      const textPath = path.join(workDir, 'texto.txt');
      const mp3Path = path.join(workDir, 'audio.mp3');
      await fs.writeFile(textPath, text, 'utf8');
      await runProcess(this.command, ['--voice', this.voice, '--file', textPath, '--write-media', mp3Path], this.timeoutMs);
      return await fs.readFile(mp3Path);
    } finally {
      await this.tmp.remove(workDir);
    }
  }
}

/**
 * TTS via `edge-tts-universal` (Node puro). Se o serviço recusar a conexão, a lib
 * espera indefinidamente; o timeout garante que a resposta caia para texto.
 */
export class EdgeTextToSpeech implements ITextToSpeech {
  constructor(
    private readonly voice: string,
    private readonly timeoutMs: number,
  ) {}

  async synthesize(text: string): Promise<Buffer> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Edge-TTS sem resposta em ${this.timeoutMs}ms.`)), this.timeoutMs);
    });
    try {
      return await Promise.race([this.collect(text), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async collect(text: string): Promise<Buffer> {
    const communicate = new Communicate(text, { voice: this.voice, connectionTimeout: CONNECTION_TIMEOUT_MS });
    const chunks: Buffer[] = [];
    for await (const chunk of communicate.stream()) {
      if (chunk.type === 'audio' && chunk.data) chunks.push(chunk.data);
    }
    if (chunks.length === 0) throw new Error('Edge-TTS não retornou áudio.');
    return Buffer.concat(chunks);
  }
}

export class TextToSpeechFactory {
  static create(config: Config, tmp: TempFiles): ITextToSpeech {
    switch (config.ttsBackend) {
      case 'cli':
        return new EdgeTtsCliTextToSpeech(config.ttsCommand, config.ttsVoice, config.ttsTimeoutMs, tmp);
      case 'npm':
        return new EdgeTextToSpeech(config.ttsVoice, config.ttsTimeoutMs);
      default:
        throw new Error(`TTS_BACKEND "${config.ttsBackend}" inválido. Use "cli" ou "npm".`);
    }
  }
}
