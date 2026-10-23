import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Logger } from './Logger.js';

/** Arquivos temporários criados pelo agente começam com o timestamp em ms. */
const OWN_ENTRY = /^\d{13}-/;
const logger = new Logger('TempFiles');

/**
 * Gera caminhos únicos no `./tmp` e remove o que sobrou de execuções anteriores.
 */
export class TempFiles {
  constructor(readonly dir: string) {}

  /** Caminho novo (ainda não criado) com o sufixo/extensão informado. */
  async newPath(suffix: string): Promise<string> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    return path.join(this.dir, `${Date.now()}-${randomUUID().slice(0, 8)}${suffix}`);
  }

  /** Diretório temporário exclusivo (ex.: saída do Whisper). */
  async newDir(label: string): Promise<string> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    return fs.promises.mkdtemp(path.join(this.dir, `${Date.now()}-${label}-`));
  }

  async remove(...paths: Array<string | null | undefined>): Promise<void> {
    await Promise.all(
      paths.filter((item): item is string => Boolean(item)).map((item) => fs.promises.rm(item, { force: true, recursive: true })),
    );
  }

  /** Apaga sobras de execuções interrompidas; só toca em entradas criadas pelo agente. */
  purgeLeftovers(): void {
    if (!fs.existsSync(this.dir)) return;
    let removed = 0;
    for (const entry of fs.readdirSync(this.dir)) {
      if (!OWN_ENTRY.test(entry)) continue;
      try {
        fs.rmSync(path.join(this.dir, entry), { force: true, recursive: true });
        removed++;
      } catch (error) {
        logger.warn(`Não foi possível remover "${entry}" do tmp: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (removed > 0) logger.info(`${removed} arquivo(s) temporário(s) residual(is) removido(s).`);
  }
}
