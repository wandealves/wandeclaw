import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ClaudeCodeProvider } from '../src/llm/cli/ClaudeCodeProvider.js';
import { CliProvider, CliReportedError } from '../src/llm/cli/CliProvider.js';
import { OpenCodeProvider } from '../src/llm/cli/OpenCodeProvider.js';
import { LlmProviderError, ToolDefinition } from '../src/llm/types.js';

const claudeOptions = { allowedTools: 'Read,Write', permissionMode: 'dontAsk' };
const openCodeOptions = { permissions: { bash: 'deny' }, autoApprove: false };
const tools: ToolDefinition[] = [
  { type: 'function', function: { name: 'x', description: 'x', parameters: { type: 'object', properties: {} } } },
];

test('transcript separa o system prompt e achata o histórico', () => {
  const { system, prompt } = CliProvider.toTranscript([
    { role: 'system', content: 'Você é o agente.' },
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'olá!' },
    { role: 'user', content: 'que horas são?' },
  ]);
  assert.equal(system, 'Você é o agente.');
  assert.equal(prompt, '<historico>\nUsuário: oi\n\nAssistente: olá!\n</historico>\n\nResponda à mensagem atual do usuário:\nque horas são?');
  assert.equal(CliProvider.toTranscript([{ role: 'user', content: 'só isso' }]).prompt, 'só isso');
});

test('parse da saída JSON do Claude Code', () => {
  assert.equal(ClaudeCodeProvider.parseOutput('{"type":"result","subtype":"success","is_error":false,"result":" ok "}'), 'ok');
  assert.throws(
    () => ClaudeCodeProvider.parseOutput('{"type":"result","subtype":"success","is_error":true,"result":"Not logged in"}'),
    (error) => error instanceof CliReportedError && error.message === 'Not logged in',
  );
  assert.throws(() => ClaudeCodeProvider.parseOutput(''), /não retornou/);
});

test('parse dos eventos do OpenCode usa o texto do último passo', () => {
  const events = [
    { type: 'step_start' },
    { type: 'text', part: { type: 'text', text: 'Vou criar o arquivo.' } },
    { type: 'tool_use', part: { type: 'tool' } },
    { type: 'step_start' },
    { type: 'text', part: { type: 'text', text: 'Arquivo ' } },
    { type: 'text', part: { type: 'text', text: 'criado!' } },
    { type: 'step_finish' },
  ].map((event) => JSON.stringify(event));
  assert.equal(OpenCodeProvider.parseOutput(events.join('\n')), 'Arquivo criado!');

  const error = JSON.stringify({ type: 'error', error: { name: 'UnknownError', data: { message: 'Modelo inválido' } } });
  assert.throws(() => OpenCodeProvider.parseOutput(error), (e) => e instanceof CliReportedError && e.message === 'Modelo inválido');
});

test('CLI ausente vira LlmProviderError com dica', async () => {
  const provider = new ClaudeCodeProvider('cli-que-nao-existe', os.tmpdir(), 5000, claudeOptions);
  await assert.rejects(provider.chat([{ role: 'user', content: 'oi' }]), (error) => {
    return error instanceof LlmProviderError && error.provider === 'claude-code' && /não encontrada/.test(error.message);
  });
});

/** Binário falso que registra argumentos, stdin, cwd e env, e responde como a CLI real. */
function fakeCli(reply: string): { command: string; log: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-cli-'));
  const log = path.join(dir, 'log.json');
  const script = path.join(dir, 'cli.mjs');
  fs.writeFileSync(
    script,
    `#!${process.execPath}
import fs from 'node:fs';
const stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), stdin, cwd: process.cwd(), config: process.env.OPENCODE_CONFIG_CONTENT }));
process.stdout.write(${JSON.stringify(reply)});
`,
  );
  fs.chmodSync(script, 0o755);
  return { command: script, log };
}
const readLog = (log: string) => JSON.parse(fs.readFileSync(log, 'utf8'));
const unix = { skip: process.platform === 'win32' ? 'script com shebang só roda em Unix' : false };

test('Claude Code: ferramentas nativas só com tools; prompt pelo stdin; cwd = workspace', unix, async () => {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')));
  const { command, log } = fakeCli('{"type":"result","subtype":"success","is_error":false,"result":"feito"}');
  const provider = new ClaudeCodeProvider(command, workspace, 5000, { ...claudeOptions, model: 'sonnet' });
  const messages = [
    { role: 'system' as const, content: 'SYS' },
    { role: 'user' as const, content: 'crie um arquivo' },
  ];

  assert.equal((await provider.chat(messages, { tools })).content, 'feito');
  let call = readLog(log);
  assert.equal(call.cwd, workspace);
  assert.equal(call.stdin, 'crie um arquivo');
  assert.deepEqual(call.args.slice(call.args.indexOf('--tools'), call.args.indexOf('--tools') + 6), [
    '--tools', 'Read,Write', '--allowedTools', 'Read,Write', '--permission-mode', 'dontAsk',
  ]);
  assert.ok(call.args.includes('sonnet'));
  assert.match(call.args[call.args.indexOf('--append-system-prompt') + 1], /^SYS\n\n## Ferramentas nesta execução\n.*nativas/);

  await provider.chat(messages); // SkillRouter: sem tools
  call = readLog(log);
  assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
  assert.ok(!call.args.includes('--allowedTools'));
});

test('OpenCode: instruções no stdin, permissões via env e agente "plan" sem tools', unix, async () => {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')));
  const { command, log } = fakeCli(`${JSON.stringify({ type: 'text', part: { text: 'oi!' } })}\n`);
  const provider = new OpenCodeProvider(command, workspace, 5000, { ...openCodeOptions, model: 'opencode/x' });

  assert.equal((await provider.chat([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'oi' }], { tools })).content, 'oi!');
  let call = readLog(log);
  assert.deepEqual(call.args.slice(0, 6), ['run', '--format', 'json', '--dir', workspace, '--model']);
  assert.ok(!call.args.includes('--agent') && !call.args.includes('--auto'));
  assert.match(call.stdin, /^<instrucoes_do_sistema>\nSYS\n\n## Ferramentas[\s\S]*<\/instrucoes_do_sistema>\n\noi$/);
  assert.deepEqual(JSON.parse(call.config), { permission: { bash: 'deny' } });

  await provider.chat([{ role: 'user', content: 'roteie' }]);
  call = readLog(log);
  assert.equal(call.args[call.args.indexOf('--agent') + 1], 'plan');
});

test('erro reportado pela CLI (exit 1 + JSON no stdout) chega como mensagem legível', unix, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-cli-'));
  const script = path.join(dir, 'cli.mjs');
  const error = JSON.stringify({ type: 'error', error: { data: { message: 'Modelo inválido' } } });
  fs.writeFileSync(script, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(error)});\nprocess.exit(1);\n`);
  fs.chmodSync(script, 0o755);

  const provider = new OpenCodeProvider(script, os.tmpdir(), 5000, openCodeOptions);
  await assert.rejects(provider.chat([{ role: 'user', content: 'oi' }]), /\[opencode\] Modelo inválido/);
});
