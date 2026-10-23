import { ToolDefinition } from '../llm/types.js';
import { BaseTool } from './BaseTool.js';

/**
 * Registro dinâmico das ferramentas disponíveis ao AgentLoop.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, BaseTool>();

  register(tool: BaseTool): this {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) throw new Error(`Nome de ferramenta inválido: "${tool.name}"`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.toDefinition());
  }
}
