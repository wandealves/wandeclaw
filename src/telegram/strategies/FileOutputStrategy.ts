import fs from 'node:fs/promises';
import path from 'node:path';
import { InputFile, type Context } from 'grammy';
import { Logger } from '../../utils/Logger.js';
import { OutputStrategy } from './OutputStrategy.js';
import { TextOutputStrategy } from './TextOutputStrategy.js';

export interface ExtractedFile {
  name: string;
  content: string;
}

const FILE_BLOCK = /<arquivo\s+nome="([^"]+)"\s*>\r?\n?([\s\S]*?)<\/arquivo>/g;
const logger = new Logger('FileOutput');

/**
 * Converte blocos `<arquivo nome="x.md">...</arquivo>` da resposta em documentos
 * do Telegram; o texto fora dos blocos segue pela estratégia de texto.
 */
export class FileOutputStrategy implements OutputStrategy {
  constructor(
    private readonly tmpDir: string,
    private readonly text: TextOutputStrategy,
  ) {}

  static hasFiles(content: string): boolean {
    return new RegExp(FILE_BLOCK.source).test(content);
  }

  static extract(content: string): { files: ExtractedFile[]; remainder: string } {
    const files = [...content.matchAll(FILE_BLOCK)].map((match) => ({
      name: FileOutputStrategy.safeName(match[1]),
      content: match[2].trimEnd(),
    }));
    const remainder = content.replace(FILE_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim();
    return { files, remainder };
  }

  async send(ctx: Context, content: string): Promise<void> {
    const { files, remainder } = FileOutputStrategy.extract(content);
    if (remainder) await this.text.send(ctx, remainder);

    for (const file of files) {
      await this.sendFile(ctx, file);
    }
  }

  private async sendFile(ctx: Context, file: ExtractedFile): Promise<void> {
    const tmpPath = path.join(this.tmpDir, `${Date.now()}-${file.name}`);
    try {
      await fs.mkdir(this.tmpDir, { recursive: true });
      await fs.writeFile(tmpPath, file.content, 'utf8');
    } catch (error) {
      // EC-02: sem acesso ao tmp, envia o conteúdo como texto.
      logger.error(`Não foi possível gravar "${file.name}" no tmp`, error);
      await this.text.send(ctx, `Não consegui gerar o arquivo ${file.name}, segue o texto puro:\n\n${file.content}`);
      return;
    }

    try {
      await ctx.replyWithDocument(new InputFile(tmpPath, file.name));
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  }

  private static safeName(raw: string): string {
    const base = path.basename(raw.trim()).replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '') || 'documento';
    return path.extname(base) ? base : `${base}.md`;
  }
}
