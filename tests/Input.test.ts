import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import type { AgentController, MessageOptions } from '../src/agent/AgentController.js';
import { DocumentExtractor } from '../src/media/DocumentExtractor.js';
import { ISpeechToText, SpeechToTextUnavailableError } from '../src/media/SpeechToText.js';
import { TelegramFileDownloader } from '../src/telegram/TelegramFileDownloader.js';
import { TelegramInputHandler } from '../src/telegram/TelegramInputHandler.js';
import type { TelegramOutputHandler } from '../src/telegram/TelegramOutputHandler.js';
import { TempFiles } from '../src/utils/TempFiles.js';

const OWNER = 42;

/** Monta o handler com um bot cuja API é interceptada e dependências falsas. */
function setup(transcript: () => Promise<string> = async () => 'texto falado') {
  const tmp = new TempFiles(fs.mkdtempSync(path.join(os.tmpdir(), 'claw-input-')));
  const bot = new Bot('123:fake', {
    botInfo: { id: 1, is_bot: true, first_name: 'claw', username: 'claw_bot' } as never,
  });
  const replies: string[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'sendMessage') replies.push((payload as { text: string }).text);
    return { ok: true, result: true } as never;
  });

  const handled: Array<{ text: string; options?: MessageOptions }> = [];
  const controller = {
    handleMessage: async (_user: string, text: string, options?: MessageOptions) => {
      handled.push({ text, options });
      return { text: 'ok', isError: false, isAudio: false };
    },
  } as unknown as AgentController;
  const sent: string[] = [];
  const output = { send: async (_ctx: unknown, reply: { text: string }) => void sent.push(reply.text) } as unknown as TelegramOutputHandler;

  // Downloader falso: "baixa" copiando o fixture indicado pelo file_id.
  const downloaded: string[] = [];
  const downloader = {
    download: async (fileId: string, extension: string) => {
      const target = await tmp.newPath(extension);
      fs.copyFileSync(fileId, target);
      downloaded.push(target);
      return target;
    },
  } as unknown as TelegramFileDownloader;
  const speechToText: ISpeechToText = { transcribe: transcript };

  new TelegramInputHandler(bot, new Set([OWNER]), controller, output, {
    downloader,
    documents: new DocumentExtractor(1024 * 1024),
    speechToText,
    tmp,
    maxDocumentBytes: 1024 * 1024,
  }).register();

  let updateId = 0;
  const send = async (message: Record<string, unknown>, from = OWNER) => {
    await bot.handleUpdate({
      update_id: ++updateId,
      message: { message_id: updateId, date: 0, chat: { id: from, type: 'private' }, from: { id: from, is_bot: false, first_name: 'u' }, ...message },
    } as Update);
    await sleep(50); // handlers de mídia rodam em background
  };
  /** Espera o handler em background terminar (o 1º parse de PDF carrega o pdf.js). */
  const settle = async () => {
    for (let i = 0; i < 100 && handled.length + replies.length === 0; i++) await sleep(50);
  };
  return { send, settle, replies, handled, sent, downloaded, tmp };
}

test('ignora quem não está na whitelist', async () => {
  const { send, replies, handled } = setup();
  await send({ text: 'oi' }, 999);
  assert.deepEqual(replies, []);
  assert.deepEqual(handled, []);
});

test('texto com pedido de áudio liga requiresAudioReply', async () => {
  const { send, handled } = setup();
  await send({ text: 'me responde em áudio: que horas são?' });
  assert.equal(handled[0].options?.requiresAudioReply, true);
});

test('PDF vira texto com a legenda, e o arquivo temporário é apagado', async () => {
  const { send, settle, handled, downloaded, tmp } = setup();
  await send({ caption: 'Resuma', document: { file_id: path.join('tests', 'fixtures', 'sample.pdf'), file_unique_id: 'u', file_name: 'sample.pdf', mime_type: 'application/pdf', file_size: 600 } });
  await settle();

  assert.equal(handled.length, 1);
  assert.match(handled[0].text, /^Resuma\n\n<documento nome="sample.pdf">\nOla PDF de teste\n<\/documento>$/);
  assert.equal(handled[0].options?.requiresAudioReply, false);
  assert.equal(downloaded.length, 1);
  assert.deepEqual(fs.readdirSync(tmp.dir), []);
});

test('anexo não suportado recebe aviso e não chega ao agente', async () => {
  const { send, replies, handled } = setup();
  await send({ document: { file_id: 'x', file_unique_id: 'u', file_name: 'planilha.xlsx', file_size: 10 } });
  await send({ photo: [{ file_id: 'p', file_unique_id: 'p', width: 1, height: 1 }] });
  assert.equal(replies.length, 2);
  for (const reply of replies) assert.match(reply, /só consigo processar texto estruturado \(.md\), áudio e PDF/);
  assert.deepEqual(handled, []);
});

test('voz é transcrita e pede resposta em áudio', async () => {
  const { send, handled, tmp } = setup();
  await send({ voice: { file_id: path.join('tests', 'fixtures', 'sample.pdf'), file_unique_id: 'v', duration: 2, mime_type: 'audio/ogg' } });
  assert.deepEqual(handled, [{ text: 'texto falado', options: { requiresAudioReply: true } }]);
  assert.deepEqual(fs.readdirSync(tmp.dir), []);
});

test('áudio mudo e Whisper ausente geram avisos sem acionar o agente', async () => {
  const silent = setup(async () => '  ');
  await silent.send({ voice: { file_id: path.join('tests', 'fixtures', 'sample.pdf'), file_unique_id: 'v', duration: 1 } });
  assert.deepEqual(silent.replies, ['Áudio vazio captado. Pode reenviar?']);

  const missing = setup(async () => { throw new SpeechToTextUnavailableError('whisper não encontrado'); });
  await missing.send({ voice: { file_id: path.join('tests', 'fixtures', 'sample.pdf'), file_unique_id: 'v', duration: 1 } });
  assert.deepEqual(missing.replies, ['⚠️ Não consegui inicializar o Whisper local agora.']);
  assert.deepEqual([...silent.handled, ...missing.handled], []);
});
