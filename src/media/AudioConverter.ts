import { runProcess } from '../utils/Process.js';

const FFMPEG_TIMEOUT_MS = 60_000;

/**
 * Conversões de áudio via ffmpeg instalado no host.
 */
export class AudioConverter {
  constructor(private readonly ffmpegPath: string) {}

  /** WAV 16 kHz mono, formato exigido pelo whisper.cpp. */
  async toWav16k(input: string, output: string): Promise<void> {
    await runProcess(this.ffmpegPath, ['-y', '-loglevel', 'error', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output], FFMPEG_TIMEOUT_MS);
  }

  /** OGG/Opus, formato das mensagens de voz do Telegram. */
  async toOggOpus(input: string, output: string): Promise<void> {
    await runProcess(this.ffmpegPath, ['-y', '-loglevel', 'error', '-i', input, '-c:a', 'libopus', '-b:a', '48k', output], FFMPEG_TIMEOUT_MS);
  }
}
