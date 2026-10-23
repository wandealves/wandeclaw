import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SkillLoader } from '../src/skills/SkillLoader.js';
import { SkillRouter } from '../src/skills/SkillRouter.js';

function makeSkillsDir(files: Record<string, string | null>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  for (const [folder, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, folder));
    if (content !== null) fs.writeFileSync(path.join(dir, folder, 'SKILL.md'), content);
  }
  return dir;
}

test('carrega skills válidas e ignora pastas sem SKILL.md ou com frontmatter inválido', () => {
  const dir = makeSkillsDir({
    boa: '---\nname: boa\ndescription: Uma skill boa\n---\n# Corpo',
    ghost: null,
    sem_frontmatter: '# Só um header\nname: x',
    sem_descricao: '---\nname: incompleta\n---\ncorpo',
  });

  const skills = new SkillLoader(dir).loadAll();
  assert.deepEqual(skills.map((skill) => skill.name), ['boa']);
});

test('skill duplicada: a última lida substitui a anterior', () => {
  const dir = makeSkillsDir({
    a: '---\nname: dup\ndescription: primeira\n---\n',
    b: '---\nname: dup\ndescription: segunda\n---\n',
  });

  const skills = new SkillLoader(dir).loadAll();
  assert.equal(skills.length, 1);
  assert.equal(skills[0].description, 'segunda');
});

test('diretório inexistente retorna lista vazia', () => {
  assert.deepEqual(new SkillLoader('/caminho/que/nao/existe').loadAll(), []);
});

test('router: parse de decisão com fallback para null', () => {
  const skills = [{ name: 'prd-manager', description: 'x', filePath: '' }];
  assert.equal(SkillRouter.parseDecision('{"skillName": "prd-manager"}', skills), 'prd-manager');
  assert.equal(SkillRouter.parseDecision('```json\n{"skillName":"prd-manager"}\n```', skills), 'prd-manager');
  assert.equal(SkillRouter.parseDecision('{"skillName": null}', skills), null);
  assert.equal(SkillRouter.parseDecision('{"skillName": "inventada"}', skills), null);
  assert.equal(SkillRouter.parseDecision('não é json', skills), null);
  assert.equal(SkillRouter.parseDecision(null, skills), null);
});
