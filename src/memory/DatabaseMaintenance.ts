import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { Logger } from '../utils/Logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_FILE = /^backup-.+\.db$/;
/** Fração de páginas livres a partir da qual o VACUUM compensa. */
const VACUUM_FREE_RATIO = 0.2;
const logger = new Logger('DbMaintenance');

/**
 * Backups diários do SQLite (mantendo os N mais recentes) e VACUUM quando o
 * arquivo está fragmentado. Falhas aqui nunca derrubam o agente.
 */
export class DatabaseMaintenance {
  constructor(
    private readonly db: Database.Database,
    private readonly backupDir: string,
    private readonly keep: number,
  ) {}

  /** Roda agora e a cada 24h. */
  schedule(): NodeJS.Timeout {
    void this.run();
    return setInterval(() => void this.run(), DAY_MS).unref();
  }

  async run(): Promise<void> {
    if (this.db.memory) return;
    try {
      await this.backupIfDue();
      this.vacuumIfFragmented();
    } catch (error) {
      logger.error('Falha na manutenção do banco', error);
    }
  }

  private async backupIfDue(): Promise<void> {
    if (this.keep === 0) return;
    fs.mkdirSync(this.backupDir, { recursive: true });

    const backups = this.listBackups();
    const newest = backups.at(-1);
    if (newest && Date.now() - fs.statSync(newest).mtimeMs < DAY_MS) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(this.backupDir, `backup-${stamp}.db`);
    await this.db.backup(target);
    logger.info(`Backup do banco salvo em ${path.basename(target)}.`);

    for (const old of this.listBackups().slice(0, -this.keep)) fs.rmSync(old, { force: true });
  }

  private vacuumIfFragmented(): void {
    const pages = this.db.pragma('page_count', { simple: true }) as number;
    const free = this.db.pragma('freelist_count', { simple: true }) as number;
    if (pages === 0 || free / pages < VACUUM_FREE_RATIO) return;
    this.db.exec('VACUUM');
    logger.info(`VACUUM executado (${free}/${pages} páginas livres).`);
  }

  /** Backups em ordem cronológica (o nome contém o timestamp ISO). */
  private listBackups(): string[] {
    return fs
      .readdirSync(this.backupDir)
      .filter((name) => BACKUP_FILE.test(name))
      .sort()
      .map((name) => path.join(this.backupDir, name));
  }
}
