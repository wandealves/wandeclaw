import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Context } from 'grammy';
import { AudioConverter } from '../src/media/AudioConverter.js';
import { DocumentExtractor, DocumentTooLargeError } from '../src/media/DocumentExtractor.js';
import { OpenAIWhisperTranscriber, SpeechToTextUnavailableError } from '../src/media/SpeechToText.js';
import { AudioReplyDetector } from '../src/telegram/AudioReplyDetector.js';
import { AudioOutputStrategy } from '../src/telegram/strategies/AudioOutputStrategy.js';
import { FileOutputStrategy } from '../src/telegram/strategies/FileOutputStrategy.js';
import { TextOutputStrategy } from '../src/telegram/strategies/TextOutputStrategy.js';
import { TempFiles } from '../src/utils/TempFiles.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claw-'));

test('detecta pedido explícito de resposta em áudio', () => {
  assert.ok(AudioReplyDetector.detect('Cria um PRD e me responde em áudio'));
  assert.ok(AudioReplyDetector.detect('fale comigo'));
  assert.ok(AudioReplyDetector.detect('manda a resposta por voz'));
  assert.ok(!AudioReplyDetector.detect('responda isso sem ser em áudio'));
  assert.ok(!AudioReplyDetector.detect('o que é um arquivo de áudio?'));
  assert.ok(AudioReplyDetector.declined('não precisa responder em voz'));
});

test('detecta PDF e Markdown; rejeita outros tipos', () => {
  assert.equal(DocumentExtractor.detect('a.pdf', undefined), 'pdf');
  assert.equal(DocumentExtractor.detect('x', 'application/pdf'), 'pdf');
  assert.equal(DocumentExtractor.detect('NOTAS.MD', 'text/plain'), 'markdown');
  assert.equal(DocumentExtractor.detect('planilha.xlsx', 'application/vnd.ms-excel'), null);
  assert.equal(DocumentExtractor.detect('foto.jpg', 'image/jpeg'), null);
});

test('extrai texto de PDF e de Markdown', async () => {
  const extractor = new DocumentExtractor(1024 * 1024);
  assert.equal(await extractor.extract(path.join('tests', 'fixtures', 'sample.pdf'), 'pdf'), 'Ola PDF de teste');

  const md = path.join(tmpDir(), 'n.md');
  fs.writeFileSync(md, '# Título\n\n\n\nCorpo\u0000');
  assert.equal(await extractor.extract(md, 'markdown'), '# Título\n\nCorpo');
});

test('documento acima do limite gera DocumentTooLargeError', async () => {
  const md = path.join(tmpDir(), 'grande.md');
  fs.writeFileSync(md, 'x'.repeat(2048));
  await assert.rejects(new DocumentExtractor(1024).extract(md, 'markdown'), DocumentTooLargeError);
});

test('Whisper ausente vira SpeechToTextUnavailableError e limpa o diretório de trabalho', async () => {
  const tmp = new TempFiles(tmpDir());
  const stt = new OpenAIWhisperTranscriber('comando-whisper-inexistente', 'base', 'pt', 5000, tmp);
  await assert.rejects(stt.transcribe('/nao/existe.ogg'), SpeechToTextUnavailableError);
  assert.deepEqual(fs.readdirSync(tmp.dir), []);
});

test('remove Markdown antes do TTS', () => {
  const speech = AudioOutputStrategy.toSpeech(
    '# Resumo\n\n- **Item um** com `código`\n- [link](https://x.com)\n\n```js\nconsole.log(1)\n```\nFim _aqui_.',
  );
  assert.equal(speech, 'Resumo\nItem um com código\nlink\nFim aqui.');
});

/** Contexto falso do grammy que só registra o que foi enviado. */
function fakeContext() {
  const sent: string[] = [];
  const ctx = {
    reply: async (text: string) => void sent.push(`text:${text}`),
    replyWithVoice: async () => void sent.push('voice'),
    replyWithDocument: async () => void sent.push('document'),
    replyWithChatAction: async () => true,
  } as unknown as Context;
  return { ctx, sent };
}

test('falha no TTS cai para texto com aviso, e arquivos seguem como documento', async () => {
  const tmp = new TempFiles(tmpDir());
  const text = new TextOutputStrategy();
  const failingTts = { synthesize: async () => { throw new Error('sem rede'); } };
  const strategy = new AudioOutputStrategy(failingTts, new AudioConverter('ffmpeg'), tmp, text, new FileOutputStrategy(tmp.dir, text));

  const { ctx, sent } = fakeContext();
  await strategy.send(ctx, 'Segue o PRD.\n<arquivo nome="prd.md">\n# PRD\n</arquivo>');

  assert.equal(sent.length, 2);
  assert.match(sent[0], /^text:⚠️ Não consegui gerar o áudio/);
  assert.equal(sent[1], 'document');
  assert.deepEqual(fs.readdirSync(tmp.dir), []);
});

test('purgeLeftovers remove só arquivos criados pelo agente', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${Date.now()}-abc.ogg`), 'x');
  fs.writeFileSync(path.join(dir, 'do-usuario.txt'), 'x');
  new TempFiles(dir).purgeLeftovers();
  assert.deepEqual(fs.readdirSync(dir), ['do-usuario.txt']);
});
