import { Config } from '../config/Config.js';
import { ProcessError, runProcess } from '../utils/Process.js';

const CHECK_TIMEOUT_MS = 15_000;

export interface Dependency {
  /** Para que serve (ex.: "LLM claude-code", "STT"). */
  purpose: string;
  command: string;
  /** Argumentos de um comando barato que só confirma que o binário roda. */
  probeArgs: string[];
  installHint: string;
}

export interface DependencyStatus {
  purpose: string;
  command: string;
  ok: boolean;
  detail: string;
}

/**
 * Verifica se os binários externos usados pela configuração atual estão instalados.
 */
export class DependencyChecker {
  constructor(private readonly dependencies: Dependency[]) {}

  /** Dependências relevantes para a configuração (provedores CLI da cadeia, Whisper, TTS e ffmpeg). */
  static fromConfig(config: Config, llmChain: string[]): DependencyChecker {
    const dependencies: Dependency[] = [];
    if (llmChain.includes('claude-code')) {
      dependencies.push({
        purpose: 'LLM claude-code',
        command: config.claudeCode.command,
        probeArgs: ['--version'],
        installHint: 'https://claude.com/claude-code (depois rode "claude" uma vez para fazer login)',
      });
    }
    if (llmChain.includes('opencode')) {
      dependencies.push({
        purpose: 'LLM opencode',
        command: config.openCode.command,
        probeArgs: ['--version'],
        installHint: 'https://opencode.ai (depois "opencode auth login")',
      });
    }
    dependencies.push(
      {
        purpose: 'STT (Whisper)',
        command: config.whisperCommand,
        probeArgs: ['--help'],
        installHint: config.whisperBackend === 'cpp' ? 'compile o whisper.cpp (whisper-cli)' : 'pip install openai-whisper',
      },
      { purpose: 'Áudio (ffmpeg)', command: config.ffmpegPath, probeArgs: ['-version'], installHint: 'apt install ffmpeg / winget install ffmpeg' },
    );
    if (config.ttsBackend === 'cli') {
      dependencies.push({ purpose: 'TTS (edge-tts)', command: config.ttsCommand, probeArgs: ['--version'], installHint: 'pip install edge-tts' });
    }
    return new DependencyChecker(dependencies);
  }

  async check(): Promise<DependencyStatus[]> {
    return Promise.all(this.dependencies.map((dependency) => DependencyChecker.probe(dependency)));
  }

  /** Texto de uma linha por dependência, para log e /status. */
  static format(statuses: DependencyStatus[]): string {
    return statuses.map((status) => `${status.ok ? '✅' : '⚠️'} ${status.purpose}: ${status.detail}`).join('\n');
  }

  private static async probe(dependency: Dependency): Promise<DependencyStatus> {
    const base = { purpose: dependency.purpose, command: dependency.command };
    try {
      const { stdout, stderr } = await runProcess(dependency.command, dependency.probeArgs, CHECK_TIMEOUT_MS);
      // Saída de --help não diz a versão; só a de --version/-version vale mostrar.
      const version = dependency.probeArgs.includes('--help')
        ? ''
        : (`${stdout}\n${stderr}`.split('\n').map((line) => line.trim()).find(Boolean) ?? '');
      return { ...base, ok: true, detail: `${dependency.command} (${version.slice(0, 60) || 'instalado'})` };
    } catch (error) {
      const missing = error instanceof ProcessError && error.reason === 'not_found';
      return {
        ...base,
        ok: false,
        detail: missing
          ? `"${dependency.command}" não encontrado — ${dependency.installHint}`
          : `"${dependency.command}" não respondeu (${error instanceof Error ? error.message : String(error)})`,
      };
    }
  }
}
