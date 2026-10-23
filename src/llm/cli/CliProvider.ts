import { ProcessError, runProcess } from '../../utils/Process.js';
import { ChatMessage, ChatOptions, ILlmProvider, LlmProviderError, LlmResponse } from '../types.js';

export interface CliInvocation {
  args: string[];
  input: string;
  env?: Record<string, string>;
}

/** Erro informado pela própria CLI (ex.: modelo inválido, sem login). */
export class CliReportedError extends Error {}

/**
 * O system prompt do agente lista as tools do ToolRegistry, que não existem dentro da CLI.
 */
const NATIVE_TOOLS_NOTE = [
  '## Ferramentas nesta execução',
  'Ignore a lista de ferramentas acima: use as suas ferramentas nativas.',
  'Seu diretório atual é o workspace do agente; crie e leia arquivos somente dentro dele.',
].join('\n');
const TEXT_ONLY_NOTE = '## Ferramentas nesta execução\nNenhuma ferramenta disponível: responda apenas com texto.';

const ROLE_LABELS: Record<string, string> = { user: 'Usuário', assistant: 'Assistente', tool: 'Ferramenta' };

/**
 * Base para "cérebros" que são agentes de linha de comando (Claude Code, OpenCode).
 * A CLI roda o próprio loop de ferramentas no workspace e devolve só a resposta final,
 * então o AgentLoop termina na primeira iteração.
 *
 * As ferramentas nativas só são liberadas quando o chamador oferece tools (o AgentLoop);
 * chamadas sem tools (ex.: SkillRouter) são apenas texto.
 */
export abstract class CliProvider implements ILlmProvider {
  abstract readonly name: string;

  constructor(
    protected readonly command: string,
    protected readonly workspaceDir: string,
    protected readonly timeoutMs: number,
  ) {}

  /** Monta argumentos e stdin para a CLI. */
  protected abstract buildInvocation(system: string, prompt: string, withTools: boolean): CliInvocation;

  /** Extrai a resposta final do stdout; lança `CliReportedError` quando a CLI reporta erro. */
  protected abstract parseOutput(stdout: string): string;

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<LlmResponse> {
    const withTools = Boolean(options.tools?.length);
    const transcript = CliProvider.toTranscript(messages);
    const system = [transcript.system, withTools ? NATIVE_TOOLS_NOTE : TEXT_ONLY_NOTE].filter(Boolean).join('\n\n');
    const { args, input, env } = this.buildInvocation(system, transcript.prompt, withTools);

    let stdout: string;
    try {
      ({ stdout } = await runProcess(this.command, args, this.timeoutMs, { input, env, cwd: this.workspaceDir }));
    } catch (error) {
      throw this.toProviderError(error);
    }

    try {
      return { content: this.parseOutput(stdout), toolCalls: [] };
    } catch (error) {
      throw new LlmProviderError(this.name, error instanceof Error ? error.message : String(error));
    }
  }

  /** Separa o system prompt e achata o histórico num único prompt de texto. */
  static toTranscript(messages: ChatMessage[]): { system: string; prompt: string } {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content ?? '')
      .join('\n\n');
    const turns = messages.filter((message) => message.role !== 'system' && message.content);
    const last = turns.at(-1);
    if (!last) return { system, prompt: '' };
    if (turns.length === 1) return { system, prompt: last.content! };

    const history = turns
      .slice(0, -1)
      .map((message) => `${ROLE_LABELS[message.role]}: ${message.content}`)
      .join('\n\n');
    return {
      system,
      prompt: `<historico>\n${history}\n</historico>\n\nResponda à mensagem atual do usuário:\n${last.content}`,
    };
  }

  private toProviderError(error: unknown): LlmProviderError {
    if (!(error instanceof ProcessError)) {
      return new LlmProviderError(this.name, error instanceof Error ? error.message : String(error));
    }
    if (error.reason === 'not_found') {
      return new LlmProviderError(this.name, `CLI "${this.command}" não encontrada — instale-a ou ajuste o comando no .env`);
    }
    // Erros reportados pela própria CLI (JSON no stdout) são mais úteis que o stderr.
    try {
      this.parseOutput(error.stdout);
    } catch (parsed) {
      if (parsed instanceof CliReportedError) return new LlmProviderError(this.name, parsed.message);
    }
    return new LlmProviderError(this.name, error.message);
  }
}
