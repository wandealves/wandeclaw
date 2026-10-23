import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { DatabaseMaintenance } from '../src/memory/DatabaseMaintenance.js';

test('faz backup no máximo uma vez por dia e mantém só os N mais recentes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-db-'));
  const backups = path.join(dir, 'backups');
  const db = new Database(path.join(dir, 'test.db'));
  db.exec('CREATE TABLE t (x TEXT)');

  fs.mkdirSync(backups);
  for (const day of ['2020-01-01', '2020-01-02']) {
    const old = path.join(backups, `backup-${day}T00-00-00-000Z.db`);
    fs.writeFileSync(old, '');
    fs.utimesSync(old, new Date(day), new Date(day));
  }

  const maintenance = new DatabaseMaintenance(db, backups, 2);
  await maintenance.run();
  await maintenance.run();
  db.close();

  const files = fs.readdirSync(backups).sort();
  assert.equal(files.length, 2);
  assert.equal(files[0], 'backup-2020-01-02T00-00-00-000Z.db');
  assert.ok(fs.statSync(path.join(backups, files[1])).size > 0);
});
