import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Bot, Context } from 'grammy';
import { LinkedInClient, LinkedInPublishError } from '../src/linkedin/LinkedInClient.js';
import { LinkedInDrafts } from '../src/linkedin/LinkedInDrafts.js';
import { LinkedInDraftHandler, LINKEDIN_MAX_POST_LENGTH } from '../src/telegram/LinkedInDraftHandler.js';
import { TelegramOutputHandler } from '../src/telegram/TelegramOutputHandler.js';
import { runProcess } from '../src/utils/Process.js';

const CREDENTIALS = { accessToken: 'tok', personUrn: 'urn:li:person:abc', apiVersion: '202610' };
const FULL_DAY_MS = 24 * 60 * 60 * 1000;

function clientReturning(response: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response();
  }) as unknown as typeof fetch;
  return { client: new LinkedInClient(CREDENTIALS, fetchFn), calls };
}

/** Bot e Context mínimos: registra as respostas e dispara o botão com `click`. */
function harness(client: LinkedInClient | null, userId = 1) {
  const replies: { text: string; markup: unknown }[] = [];
  const markups: unknown[] = [];
  const answers: string[] = [];
  let onClick: ((ctx: any) => void) | undefined;

  const ctx = (from: number, data?: string) => ({
    from: { id: from },
    match: data?.match(/^li:(pub|del):([0-9a-f]+)$/),
    reply: async (text: string, options?: { reply_markup?: unknown }) => {
      replies.push({ text, markup: options?.reply_markup });
    },
    answerCallbackQuery: async (options: { text: string }) => {
      answers.push(options.text);
    },
    editMessageReplyMarkup: async (options?: { reply_markup?: unknown }) => {
      markups.push(options?.reply_markup);
    },
  });

  const handler = new LinkedInDraftHandler(new LinkedInDrafts(), client);
  handler.register({ callbackQuery: (_: unknown, fn: (ctx: any) => void) => (onClick = fn) } as unknown as Bot);

  const click = async (data: string, from = userId) => {
    onClick!(ctx(from, data));
    await new Promise((resolve) => setImmediate(resolve));
  };
  const lastButtons = () => {
    const markup = replies.findLast((reply) => reply.markup)?.markup as {
      inline_keyboard: { callback_data: string }[][];
    };
    return markup.inline_keyboard[0].map((button) => button.callback_data);
  };
  return { handler, replies, markups, answers, click, lastButtons, context: ctx(userId) as unknown as Context };
}

test('extrai vários rascunhos e mantém o restante da resposta', () => {
  const { drafts, remainder } = LinkedInDrafts.extract(
    'Duas opções:\n<linkedin-post>\nPrimeira\n</linkedin-post>\n\n<linkedin-post>Segunda</linkedin-post>\nEscolha uma.',
  );
  assert.deepEqual(drafts, ['Primeira', 'Segunda']);
  assert.equal(remainder, 'Duas opções:\n\nEscolha uma.');
});

test('bloco vazio não vira rascunho', () => {
  assert.deepEqual(LinkedInDrafts.extract('Oi <linkedin-post>  \n </linkedin-post>'), { drafts: [], remainder: 'Oi' });
});

test('escapa reservados do formato little e preserva hashtags', () => {
  assert.equal(
    LinkedInClient.escapeCommentary('Teste (ok) *a* _b_ ~c~ [d] {e} <f> g|h a@b.com \\ C# nº #1 # #MinhaTag #ação'),
    'Teste \\(ok\\) \\*a\\* \\_b\\_ \\~c\\~ \\[d\\] \\{e\\} \\<f\\> g\\|h a\\@b.com \\\\ C\\# nº #1 \\# #MinhaTag #ação',
  );
});

test('publica com headers, corpo e autor esperados', async () => {
  const { client, calls } = clientReturning(
    () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:123' } }),
  );

  assert.equal(await client.publish('Olá (mundo) #dev'), 'https://www.linkedin.com/feed/update/urn:li:share:123/');
  assert.equal(calls[0].url, 'https://api.linkedin.com/rest/posts');
  assert.deepEqual(calls[0].init.headers, {
    Authorization: 'Bearer tok',
    'Content-Type': 'application/json',
    'Linkedin-Version': '202610',
    'X-Restli-Protocol-Version': '2.0.0',
  });
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.author, 'urn:li:person:abc');
  assert.equal(body.commentary, 'Olá \\(mundo\\) #dev');
  assert.equal(body.visibility, 'PUBLIC');
  assert.equal(body.lifecycleState, 'PUBLISHED');
});

test('classifica 4xx como recusa e 5xx ou rede como ambíguo', async () => {
  await assert.rejects(clientReturning(() => new Response('x', { status: 401 })).client.publish('a'), (error) => {
    assert.ok(error instanceof LinkedInPublishError);
    return error.kind === 'rejected' && error.status === 401;
  });
  await assert.rejects(clientReturning(() => new Response('x', { status: 503 })).client.publish('a'), { kind: 'ambiguous' });
  await assert.rejects(
    clientReturning(() => {
      throw new Error('rede');
    }).client.publish('a'),
    { kind: 'ambiguous' },
  );
});

test('rascunho expira em 24 h e só o dono pode retirá-lo', () => {
  let now = 0;
  const drafts = new LinkedInDrafts(() => now);
  const id = drafts.add('1', 'post');

  assert.equal(drafts.take(id, '2'), null);
  assert.equal(drafts.take(id, '1')?.text, 'post');

  const old = drafts.add('1', 'antigo');
  now = FULL_DAY_MS + 1;
  assert.equal(drafts.take(old, '1'), null);
});

test('duplo clique publica uma única vez', async () => {
  const { client, calls } = clientReturning(
    () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } }),
  );
  const bot = harness(client);
  await bot.handler.send(bot.context, ['post']);
  const [publish] = bot.lastButtons();

  await bot.click(publish);
  await bot.click(publish);

  assert.equal(calls.length, 1);
  assert.ok(bot.replies.at(-1)!.text.includes('urn:li:share:1'));
  assert.deepEqual(bot.answers, ['Publicando...', 'Rascunho expirado ou já processado.']);
});

test('outro usuário não publica o rascunho', async () => {
  const { client, calls } = clientReturning(() => new Response(null, { status: 201 }));
  const bot = harness(client);
  await bot.handler.send(bot.context, ['post']);

  await bot.click(bot.lastButtons()[0], 2);

  assert.equal(calls.length, 0);
});

test('cancelar descarta o rascunho sem publicar', async () => {
  const { client, calls } = clientReturning(() => new Response(null, { status: 201 }));
  const bot = harness(client);
  await bot.handler.send(bot.context, ['post']);
  const [publish, cancel] = bot.lastButtons();

  await bot.click(cancel);
  await bot.click(publish);

  assert.equal(calls.length, 0);
  assert.deepEqual(bot.answers, ['Rascunho cancelado.', 'Rascunho expirado ou já processado.']);
});

test('recusa do LinkedIn devolve os botões e permite tentar de novo', async () => {
  const statuses = [401, 201];
  const { client, calls } = clientReturning(() => new Response(null, { status: statuses.shift()! }));
  const bot = harness(client);
  await bot.handler.send(bot.context, ['post']);
  const [publish] = bot.lastButtons();

  await bot.click(publish);
  assert.ok(bot.replies.at(-1)!.text.includes('token'));
  assert.ok(bot.markups.at(-1));

  await bot.click(publish);
  assert.equal(calls.length, 2);
  assert.ok(bot.replies.at(-1)!.text.startsWith('✅'));
});

test('falha ambígua não devolve os botões', async () => {
  const { client, calls } = clientReturning(() => new Response(null, { status: 500 }));
  const bot = harness(client);
  await bot.handler.send(bot.context, ['post']);
  const [publish] = bot.lastButtons();

  await bot.click(publish);
  await bot.click(publish);

  assert.equal(calls.length, 1);
  assert.ok(bot.replies.at(-1)!.text.includes('pode ter saído'));
  assert.equal(bot.markups.at(-1), undefined);
});

test('sem credenciais mostra o rascunho sem botões', async () => {
  const bot = harness(null);
  await bot.handler.send(bot.context, ['post']);

  assert.deepEqual(bot.replies.map((reply) => reply.markup), [undefined, undefined]);
  assert.equal(bot.replies[0].text, 'post');
  assert.ok(bot.replies[1].text.includes('LINKEDIN_ACCESS_TOKEN'));
});

test('post acima do limite não recebe botões', async () => {
  const { client } = clientReturning(() => new Response(null, { status: 201 }));
  const bot = harness(client);
  await bot.handler.send(bot.context, ['a'.repeat(LINKEDIN_MAX_POST_LENGTH + 1)]);

  assert.ok(bot.replies.every((reply) => !reply.markup));
  assert.ok(bot.replies.at(-1)!.text.includes('caracteres'));
});

test('saída separa o rascunho do texto e não o lê em áudio', async () => {
  const bot = harness(null);
  const output = new TelegramOutputHandler({ dir: 'tmp' } as never, {} as never, {} as never, bot.handler);

  await output.send(bot.context, {
    text: 'Aqui vai.\n<linkedin-post>Meu post</linkedin-post>',
    isError: false,
    isAudio: false,
  });

  assert.deepEqual(bot.replies.map((reply) => reply.text).slice(0, 2), ['Aqui vai.', 'Meu post']);
});

test('token do LinkedIn não chega aos processos filhos', async () => {
  process.env.LINKEDIN_ACCESS_TOKEN = 'segredo';
  try {
    const script = 'console.log(process.env.LINKEDIN_ACCESS_TOKEN ?? "ausente")';
    const { stdout } = await runProcess(process.execPath, ['-e', script], 10_000);
    assert.equal(stdout.trim(), 'ausente');
  } finally {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
  }
});
