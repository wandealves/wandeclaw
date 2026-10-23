import { JsonSchemaObject, ToolDefinition } from '../llm/types.js';

export type ToolArgs = Record<string, unknown>;

export interface ToolResult {
  output: string;
}

/**
 * Classe base de toda ferramenta ("braço atuador") que o AgentLoop pode acionar.
 */
export abstract class BaseTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JsonSchemaObject;

  abstract execute(args: ToolArgs): Promise<ToolResult>;

  toDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: { name: this.name, description: this.description, parameters: this.parameters },
    };
  }

  /** Valida os argumentos contra o schema. Retorna a mensagem de erro ou `null`. */
  validate(args: unknown): string | null {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return 'os argumentos devem ser um objeto JSON';
    }
    const record = args as ToolArgs;

    for (const key of this.parameters.required ?? []) {
      if (record[key] === undefined || record[key] === null) return `parâmetro obrigatório "${key}" ausente`;
    }
    for (const [key, value] of Object.entries(record)) {
      const schema = this.parameters.properties[key];
      if (!schema || value === undefined || value === null) continue;
      const valid =
        schema.type === 'integer' ? Number.isInteger(value) : typeof value === schema.type;
      if (!valid) return `parâmetro "${key}" deve ser do tipo ${schema.type}`;
    }
    return null;
  }
}
