import { JsonSchemaObject } from '../../llm/types.js';
import { BaseTool, ToolResult } from '../BaseTool.js';

export class DateTimeTool extends BaseTool {
  readonly name = 'get_current_datetime';
  readonly description = 'Retorna a data e a hora atuais da máquina local do usuário.';
  readonly parameters: JsonSchemaObject = { type: 'object', properties: {} };

  async execute(): Promise<ToolResult> {
    const now = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatted = now.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'medium', timeZone });
    return { output: JSON.stringify({ iso: now.toISOString(), local: formatted, timeZone }) };
  }
}
