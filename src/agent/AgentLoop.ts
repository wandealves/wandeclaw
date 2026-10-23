import { ChatMessage, ILlmProvider, ToolCall } from '../llm/types.js';
import type { ActiveSkill } from '../skills/SkillExecutor.js';
import type { SkillMetadata } from '../skills/SkillLoader.js';
import { ToolArgs } from '../tools/BaseTool.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { Logger, errorMessage, preview } from '../utils/Logger.js';
import { SystemPromptBuilder } from './SystemPromptBuilder.js';

export interface AgentRunInput {
  history: ChatMessage[];
  availableSkills: SkillMetadata[];
  skill?: ActiveSkill | null;
}

export class MaxIterationsError extends Error {
  constructor(readonly maxIterations: number) {
    super(`Limite de ${maxIterations} iterações atingido sem resposta final.`);
    this.name = 'MaxIterationsError';
  }
}

const logger = new Logger('AgentLoop');

/**
 * Motor ReAct: Thought → Action → Observation, repetido até uma resposta final
 * ou até `maxIterations`.
 */
export class AgentLoop {
  constructor(
    private readonly provider: ILlmProvider,
    private readonly registry: ToolRegistry,
    private readonly promptBuilder: SystemPromptBuilder,
    private readonly maxIterations: number,
  ) {}

  async run(input: AgentRunInput): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: this.promptBuilder.build({
          availableSkills: input.availableSkills,
          skill: input.skill ?? null,
          toolNames: this.registry.names(),
        }),
      },
      ...input.history,
    ];
    const tools = this.registry.definitions();

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      logger.info(`── Iteração ${iteration}/${this.maxIterations} (${this.provider.name})`);
      const response = await this.provider.chat(messages, { tools });
      const content = response.content?.trim() ?? '';

      if (response.toolCalls.length === 0) {
        if (content) {
          logger.info(`✅ Answer: ${preview(content)}`);
          return content;
        }
        logger.warn('Resposta vazia do LLM; solicitando resposta final.');
        messages.push({ role: 'user', content: 'Sua última resposta veio vazia. Responda ao usuário agora.' });
        continue;
      }

      if (content) logger.info(`💭 Thought: ${preview(content)}`);
      messages.push({ role: 'assistant', content, tool_calls: response.toolCalls });

      // Tools executadas em sequência, na ordem pedida pelo LLM (NG-02).
      for (const call of response.toolCalls) {
        const observation = await this.executeToolCall(call);
        logger.info(`👁️  Observation: ${preview(observation)}`);
        messages.push({ role: 'tool', tool_call_id: call.id, content: observation });
      }
    }

    throw new MaxIterationsError(this.maxIterations);
  }

  private async executeToolCall(call: ToolCall): Promise<string> {
    const { name, arguments: rawArgs } = call.function;
    logger.info(`🔧 Action: ${name}(${preview(rawArgs, 200)})`);

    const tool = this.registry.get(name);
    if (!tool) {
      return JSON.stringify({ error: `Ferramenta "${name}" não existe. Disponíveis: ${this.registry.names().join(', ')}` });
    }

    let args: unknown;
    try {
      args = rawArgs?.trim() ? JSON.parse(rawArgs) : {};
    } catch {
      // EC-01: JSON malformado vira observação para o LLM corrigir.
      return JSON.stringify({ error: 'JSON inválido, reenvie a estrutura corrigida por favor.' });
    }

    const validationError = tool.validate(args);
    if (validationError) {
      return JSON.stringify({ error: `Argumentos inválidos: ${validationError}. Reenvie seguindo o schema.` });
    }

    try {
      return (await tool.execute(args as ToolArgs)).output;
    } catch (error) {
      // EC-02: erro da ferramenta volta como observação.
      return JSON.stringify({ error: errorMessage(error) });
    }
  }
}
