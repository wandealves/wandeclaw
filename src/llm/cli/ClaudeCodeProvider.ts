import { CliInvocation, CliProvider, CliReportedError } from './CliProvider.js';

/** Acima disso o system prompt vai pelo stdin (limite de argumentos no Windows ~32k). */
const MAX_ARG_CHARS = 24_000;

export interface ClaudeCodeOptions {
  model?: string;
  /** Ferramentas nativas liberadas (ex.: "Read,Edit,Write"). */
  allowedTools: string;
  permissionMode: string;
}

interface ClaudeResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

/**
 * Claude Code em modo headless (`claude -p`), usando o login da CLI (assinatura Claude ou API key própria dela).
 */
export class ClaudeCodeProvider extends CliProvider {
  readonly name = 'claude-code';

  constructor(
    command: string,
    workspaceDir: string,
    timeoutMs: number,
    private readonly options: ClaudeCodeOptions,
  ) {
    super(command, workspaceDir, timeoutMs);
  }

  protected buildInvocation(system: string, prompt: string, withTools: boolean): CliInvocation {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config'];
    if (this.options.model) args.push('--model', this.options.model);

    if (withTools && this.options.allowedTools) {
      // --tools restringe o conjunto; --allowedTools aprova sem perguntar; o resto é negado.
      args.push('--tools', this.options.allowedTools, '--allowedTools', this.options.allowedTools);
      args.push('--permission-mode', this.options.permissionMode);
    } else {
      args.push('--tools', '');
    }

    if (system.length <= MAX_ARG_CHARS) {
      args.push('--append-system-prompt', system);
      return { args, input: prompt };
    }
    return { args, input: `<instrucoes_do_sistema>\n${system}\n</instrucoes_do_sistema>\n\n${prompt}` };
  }

  protected parseOutput(stdout: string): string {
    return ClaudeCodeProvider.parseOutput(stdout);
  }

  static parseOutput(stdout: string): string {
    const raw = stdout.trim();
    if (!raw) throw new Error('Claude Code não retornou resposta.');

    let data: ClaudeResult;
    try {
      // Em JSON a saída é um único objeto; por segurança, usa a última linha que for JSON.
      data = JSON.parse(raw.split('\n').filter((line) => line.trim().startsWith('{')).at(-1) ?? raw) as ClaudeResult;
    } catch {
      throw new Error(`Saída inesperada do Claude Code: ${raw.slice(0, 200)}`);
    }
    if (data.is_error || (data.subtype && data.subtype !== 'success')) {
      throw new CliReportedError(data.result || `Claude Code terminou com "${data.subtype ?? 'erro'}".`);
    }
    if (!data.result?.trim()) throw new Error('Claude Code retornou resposta vazia.');
    return data.result.trim();
  }
}
