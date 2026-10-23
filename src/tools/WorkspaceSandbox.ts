import fs from 'node:fs';
import path from 'node:path';

/**
 * Confina as ferramentas de arquivo a um diretório de trabalho, sem expor caminhos
 * absolutos do host nas observações enviadas ao LLM.
 */
export class WorkspaceSandbox {
  constructor(readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  resolve(relativePath: string): string {
    const cleaned = relativePath.replace(/\0/g, '').trim();
    if (!cleaned) throw new Error('Caminho vazio.');
    if (path.isAbsolute(cleaned)) throw new Error('Use um caminho relativo ao workspace, não absoluto.');

    const fullPath = path.resolve(this.root, cleaned);
    if (fullPath !== this.root && !fullPath.startsWith(this.root + path.sep)) {
      throw new Error('Acesso fora do workspace não é permitido.');
    }
    return fullPath;
  }

  relative(fullPath: string): string {
    return path.relative(this.root, fullPath) || '.';
  }

  /** Remove o caminho absoluto do workspace de mensagens de erro (ex.: ENOENT). */
  sanitize(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.split(this.root).join('<workspace>');
  }
}
