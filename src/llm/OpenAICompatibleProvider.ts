import { ChatMessage, ChatOptions, ILlmProvider, LlmProviderError, LlmResponse, ToolCall } from './types.js';

interface RawToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

interface CompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: RawToolCall[];
    };
  }>;
}

/**
 * Base para provedores que expõem o endpoint `/chat/completions` no formato OpenAI
 * (Gemini, DeepSeek e Groq oferecem essa compatibilidade, incluindo tool calling).
 */
export abstract class OpenAICompatibleProvider implements ILlmProvider {
  abstract readonly name: string;
  protected abstract readonly baseUrl: string;

  constructor(
    protected readonly apiKey: string,
    protected readonly model: string,
    protected readonly timeoutMs: number,
  ) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((message) => ({ ...message, content: message.content ?? '' })),
    };
    if (options.tools?.length) {
      body.tools = options.tools;
      body.tool_choice = 'auto';
    }
    if (options.temperature !== undefined) body.temperature = options.temperature;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? `timeout após ${this.timeoutMs}ms`
          : `falha de rede (${error instanceof Error ? error.message : String(error)})`;
      throw new LlmProviderError(this.name, reason);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      const hint = response.status === 401 || response.status === 403 ? ' — verifique a API key no .env' : '';
      throw new LlmProviderError(this.name, `HTTP ${response.status}${hint}: ${detail}`, response.status);
    }

    const data = (await response.json()) as CompletionResponse;
    const message = data.choices?.[0]?.message;
    if (!message) throw new LlmProviderError(this.name, 'resposta sem "choices"');

    return {
      content: message.content ?? null,
      toolCalls: (message.tool_calls ?? []).map((call, index) => this.normalizeToolCall(call, index)),
    };
  }

  private normalizeToolCall(call: RawToolCall, index: number): ToolCall {
    const args = call.function?.arguments;
    return {
      id: call.id || `call_${Date.now()}_${index}`,
      type: 'function',
      function: {
        name: call.function?.name ?? '',
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      },
    };
  }
}
