export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  };
}

export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface ChatOptions {
  tools?: ToolDefinition[];
  temperature?: number;
}

/**
 * Contrato comum a todos os "cérebros" (LLMs) do agente.
 */
export interface ILlmProvider {
  readonly name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<LlmResponse>;
}

export class LlmProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'LlmProviderError';
  }
}

export class AllProvidersFailedError extends Error {
  constructor(readonly providers: string[]) {
    super(`Todos os provedores de LLM falharam (${providers.join(', ')}).`);
    this.name = 'AllProvidersFailedError';
  }
}
