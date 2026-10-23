import fs from 'node:fs/promises';
import path from 'node:path';
import { Config } from '../config/Config.js';
import { ProcessError, runProcess } from '../utils/Process.js';
import { TempFiles } from '../utils/TempFiles.js';
import { AudioConverter } from './AudioConverter.js';

/**
 * Contrato de transcrição de áudio (STT).
 */
export interface ISpeechToText {
  transcribe(audioPath: string): Promise<string>;
}

/** O Whisper (ou o ffmpeg do qual ele depende) não está instalado/acessível. */
export class SpeechToTextUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechToTextUnavailableError';
  }
}

/** Falha durante a transcrição (timeout, falta de memória, crash do processo). */
export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/**
 * Base dos transcritores via Whisper local: roda o CLI num diretório temporário
 * exclusivo e lê o `.txt` gerado.
 */
abstract class WhisperCliTranscriber implements ISpeechToText {
  constructor(
    protected readonly command: string,
    protected readonly model: string,
    protected readonly language: string | null,
    protected readonly timeoutMs: number,
    protected readonly tmp: TempFiles,
  ) {}

  protected abstract run(audioPath: string, workDir: string): Promise<string>;

  async transcribe(audioPath: string): Promise<string> {
    const workDir = await this.tmp.newDir('stt');
    try {
      const transcriptPath = await this.run(audioPath, workDir);
      return (await fs.readFile(transcriptPath, 'utf8')).replace(/\s+/g, ' ').trim();
    } catch (error) {
      if (error instanceof ProcessError && error.reason === 'not_found') {
        throw new SpeechToTextUnavailableError(error.message);
      }
      throw new TranscriptionError(error instanceof Error ? error.message : String(error));
    } finally {
      await this.tmp.remove(workDir);
    }
  }
}

/** CLI do openai-whisper (`pip install openai-whisper`); lê OGG/MP3 direto via ffmpeg. */
export class OpenAIWhisperTranscriber extends WhisperCliTranscriber {
  protected async run(audioPath: string, workDir: string): Promise<string> {
    const args = [audioPath, '--model', this.model, '--output_format', 'txt', '--output_dir', workDir, '--fp16', 'False', '--verbose', 'False'];
    if (this.language) args.push('--language', this.language);
    await runProcess(this.command, args, this.timeoutMs);
    return path.join(workDir, `${path.parse(audioPath).name}.txt`);
  }
}

/** whisper.cpp (`whisper-cli`); exige WAV 16 kHz, convertido antes pelo ffmpeg. */
export class WhisperCppTranscriber extends WhisperCliTranscriber {
  constructor(
    command: string,
    model: string,
    language: string | null,
    timeoutMs: number,
    tmp: TempFiles,
    private readonly converter: AudioConverter,
  ) {
    super(command, model, language, timeoutMs, tmp);
  }

  protected async run(audioPath: string, workDir: string): Promise<string> {
    const wavPath = path.join(workDir, 'audio.wav');
    const outputBase = path.join(workDir, 'transcript');
    await this.converter.toWav16k(audioPath, wavPath);
    await runProcess(
      this.command,
      ['-m', this.model, '-f', wavPath, '-l', this.language ?? 'auto', '-otxt', '-of', outputBase, '-np'],
      this.timeoutMs,
    );
    return `${outputBase}.txt`;
  }
}

export class SpeechToTextFactory {
  static create(config: Config, tmp: TempFiles, converter: AudioConverter): ISpeechToText {
    const { whisperCommand, whisperModel, whisperLanguage, whisperTimeoutMs } = config;
    switch (config.whisperBackend) {
      case 'openai':
        return new OpenAIWhisperTranscriber(whisperCommand, whisperModel, whisperLanguage, whisperTimeoutMs, tmp);
      case 'cpp':
        return new WhisperCppTranscriber(whisperCommand, whisperModel, whisperLanguage, whisperTimeoutMs, tmp, converter);
      default:
        throw new Error(`WHISPER_BACKEND "${config.whisperBackend}" inválido. Use "openai" ou "cpp".`);
    }
  }
}
