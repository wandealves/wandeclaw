import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentLoop, MaxIterationsError } from '../src/agent/AgentLoop.js';
import { SystemPromptBuilder } from '../src/agent/SystemPromptBuilder.js';
import { ChatMessage, ILlmProvider, LlmResponse } from '../src/llm/types.js';
import { DateTimeTool } from '../src/tools/implementations/DateTimeTool.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';

/** Provider falso que devolve respostas roteirizadas e guarda o que recebeu. */
class ScriptedProvider implements ILlmProvider {
  readonly name = 'fake';
  readonly calls: ChatMessage[][] = [];

  constructor(private readonly script: LlmResponse[]) {}

  async chat(messages: ChatMessage[]): Promise<LlmResponse> {
    this.calls.push(structuredClone(messages));
    return this.script.shift() ?? { content: null, toolCalls: [{ id: 'x', type: 'function', function: { name: 'get_current_datetime', arguments: '{}' } }] };
  }
}

const toolCall = (name: string, args: string) => ({
  content: null,
  toolCalls: [{ id: `call_${name}`, type: 'function' as const, function: { name, arguments: args } }],
});

function makeLoop(provider: ILlmProvider, maxIterations = 5): AgentLoop {
  const registry = new ToolRegistry().register(new DateTimeTool());
  return new AgentLoop(provider, registry, new SystemPromptBuilder('Teste'), maxIterations);
}

const input = { history: [{ role: 'user' as const, content: 'que horas são?' }], availableSkills: [] };

test('executa a tool e devolve a observação ao LLM antes da resposta final', async () => {
  const provider = new ScriptedProvider([toolCall('get_current_datetime', '{}'), { content: 'São 10h.', toolCalls: [] }]);
  const answer = await makeLoop(provider).run(input);

  assert.equal(answer, 'São 10h.');
  const toolMessage = provider.calls[1].find((message) => message.role === 'tool');
  assert.ok(toolMessage?.content?.includes('iso'));
});

test('JSON malformado vira observação pedindo correção', async () => {
  const provider = new ScriptedProvider([toolCall('get_current_datetime', '{quebrado'), { content: 'ok', toolCalls: [] }]);
  await makeLoop(provider).run(input);

  const toolMessage = provider.calls[1].find((message) => message.role === 'tool');
  assert.match(toolMessage!.content!, /JSON inválido/);
});

test('ferramenta inexistente vira observação de erro', async () => {
  const provider = new ScriptedProvider([toolCall('nao_existe', '{}'), { content: 'ok', toolCalls: [] }]);
  await makeLoop(provider).run(input);

  const toolMessage = provider.calls[1].find((message) => message.role === 'tool');
  assert.match(toolMessage!.content!, /não existe/);
});

test('para em MAX_ITERATIONS', async () => {
  const provider = new ScriptedProvider([]);
  await assert.rejects(makeLoop(provider, 3).run(input), MaxIterationsError);
  assert.equal(provider.calls.length, 3);
});

test('injeta a skill ativa e as availableSkills no system prompt', async () => {
  const provider = new ScriptedProvider([{ content: 'feito', toolCalls: [] }]);
  await makeLoop(provider).run({
    ...input,
    availableSkills: [{ name: 'resumidor', description: 'Resume textos', filePath: '' }],
    skill: { name: 'resumidor', content: 'INSTRUCAO-SECRETA-DA-SKILL' },
  });

  const system = provider.calls[0][0].content!;
  assert.match(system, /resumidor: Resume textos/);
  assert.match(system, /INSTRUCAO-SECRETA-DA-SKILL/);
});
