import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileOutputStrategy } from '../src/telegram/strategies/FileOutputStrategy.js';
import { TextOutputStrategy } from '../src/telegram/strategies/TextOutputStrategy.js';

test('texto curto não é fatiado', () => {
  assert.deepEqual(TextOutputStrategy.split('olá'), ['olá']);
});

test('texto de 9000 caracteres vira 3 chunks dentro do limite, sem cortar palavras', () => {
  const text = Array.from({ length: 1500 }, (_, i) => `pal${i % 10}`).join(' ').padEnd(9000, ' fim');
  const chunks = TextOutputStrategy.split(text);

  assert.equal(chunks.length, 3);
  for (const chunk of chunks) assert.ok(chunk.length <= 4000);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), text.trim().replace(/\s+/g, ' '));
});

test('extrai blocos <arquivo> e mantém o texto restante', () => {
  const content = 'Segue o PRD.\n<arquivo nome="../../etc/spec auth.md">\n# Spec\nconteúdo\n</arquivo>\nQualquer dúvida, avise.';
  assert.ok(FileOutputStrategy.hasFiles(content));

  const { files, remainder } = FileOutputStrategy.extract(content);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'spec_auth.md');
  assert.equal(files[0].content, '# Spec\nconteúdo');
  assert.equal(remainder, 'Segue o PRD.\n\nQualquer dúvida, avise.');
});

test('nome sem extensão recebe .md', () => {
  const { files } = FileOutputStrategy.extract('<arquivo nome="relatorio">x</arquivo>');
  assert.equal(files[0].name, 'relatorio.md');
});
