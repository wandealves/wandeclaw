import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DependencyChecker } from '../src/diagnostics/DependencyChecker.js';

test('detecta binário instalado e ausente, com dica de instalação', async () => {
  const checker = new DependencyChecker([
    { purpose: 'Node', command: process.execPath, probeArgs: ['--version'], installHint: '-' },
    { purpose: 'LLM fake', command: 'cli-que-nao-existe', probeArgs: ['--version'], installHint: 'instale o fake' },
  ]);
  const [node, missing] = await checker.check();

  assert.equal(node.ok, true);
  assert.match(node.detail, new RegExp(process.version.replace(/\./g, '\\.')));
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /não encontrado — instale o fake/);
  assert.equal(DependencyChecker.format([node, missing]).split('\n')[1], `⚠️ LLM fake: ${missing.detail}`);
});
