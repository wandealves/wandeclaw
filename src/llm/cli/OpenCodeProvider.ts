import { CliInvocation, CliProvider, CliReportedError } from './CliProvider.js';

export interface OpenCodeOptions {
  /** Formato provider/model (ex.: "opencode/deepseek-v4.1-flash-free"). */
  model?: string;
  agent?: string;
  /** Regras de permissão do OpenCode (JSON), aplicadas via OPENCODE_CONFIG_CONTENT. */
  permissions: Record<string, string>;
  autoApprove: boolean;
}

interface OpenCodeEvent {
  type?: string;
  part?: { type?: string; text?: string };
  error?: { name?: string; data?: { message?: string } };
}

/**
 * OpenCode em modo headless (`opencode run`), usando os provedores configurados nele
 * (`opencode auth login`), inclusive os modelos gratuitos.
 */
export class OpenCodeProvider extends CliProvider {
  readonly name = 'opencode';

  constructor(
    command: string,
    workspaceDir: string,
    timeoutMs: number,
    private readonly options: OpenCodeOptions,
  ) {
    super(command, workspaceDir, timeoutMs);
  }

  protected buildInvocation(system: string, prompt: string, withTools: boolean): CliInvocation {
    const args = ['run', '--format', 'json', '--dir', this.workspaceDir];
    if (this.options.model) args.push('--model', this.options.model);

    // Sem tools (ex.: SkillRouter) usa o agente "plan", que não edita nada.
    const agent = withTools ? this.options.agent : 'plan';
    if (agent) args.push('--agent', agent);
    if (withTools && this.options.autoApprove) args.push('--auto');

    // O OpenCode não tem flag de system prompt: as instruções vão no início da mensagem.
    const input = `<instrucoes_do_sistema>\n${system}\n</instrucoes_do_sistema>\n\n${prompt}`;
    const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: this.options.permissions }) };
    return { args, input, env };
  }

  protected parseOutput(stdout: string): string {
    return OpenCodeProvider.parseOutput(stdout);
  }

  /** Lê os eventos JSON (um por linha) e devolve o texto do último passo que tiver texto. */
  static parseOutput(stdout: string): string {
    const steps: string[][] = [[]];
    for (const line of stdout.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      let event: OpenCodeEvent;
      try {
        event = JSON.parse(line) as OpenCodeEvent;
      } catch {
        continue;
      }
      if (event.type === 'error') {
        throw new CliReportedError(event.error?.data?.message ?? event.error?.name ?? 'OpenCode reportou um erro.');
      }
      if (event.type === 'step_start') steps.push([]);
      if (event.type === 'text' && event.part?.text) steps.at(-1)!.push(event.part.text);
    }

    const answer = steps.filter((texts) => texts.length > 0).at(-1)?.join('').trim();
    if (!answer) throw new Error('OpenCode não retornou resposta.');
    return answer;
  }
}
