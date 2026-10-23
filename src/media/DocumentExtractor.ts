import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

export type DocumentKind = 'pdf' | 'markdown';

/** Texto extraído acima disso é truncado (a memória também limita cada mensagem). */
export const MAX_DOCUMENT_CHARS = 90_000;

export class DocumentTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Documento excede o limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    this.name = 'DocumentTooLargeError';
  }
}

/**
 * Converte documentos recebidos (PDF e Markdown) em texto para o AgentLoop.
 */
export class DocumentExtractor {
  constructor(private readonly maxBytes: number) {}

  /** Identifica o tipo pelo mimetype ou extensão; `null` = não suportado. */
  static detect(fileName: string | undefined, mimeType: string | undefined): DocumentKind | null {
    const extension = path.extname(fileName ?? '').toLowerCase();
    if (mimeType === 'application/pdf' || extension === '.pdf') return 'pdf';
    if (extension === '.md' || extension === '.markdown' || mimeType === 'text/markdown') return 'markdown';
    return null;
  }

  async extract(filePath: string, kind: DocumentKind): Promise<string> {
    const { size } = await fs.stat(filePath);
    if (size > this.maxBytes) throw new DocumentTooLargeError(this.maxBytes);

    const text = kind === 'pdf' ? await DocumentExtractor.readPdf(filePath) : await fs.readFile(filePath, 'utf8');
    return DocumentExtractor.clean(text);
  }

  private static async readPdf(filePath: string): Promise<string> {
    const parser = new PDFParse({ data: await fs.readFile(filePath) });
    try {
      return (await parser.getText({ pageJoiner: '' })).text;
    } finally {
      await parser.destroy();
    }
  }

  private static clean(text: string): string {
    const clean = text.replace(/\u0000/g, '').replace(/\n{3,}/g, '\n\n').trim();
    return clean.length > MAX_DOCUMENT_CHARS
      ? `${clean.slice(0, MAX_DOCUMENT_CHARS)}\n[... documento truncado em ${MAX_DOCUMENT_CHARS} caracteres]`
      : clean;
  }
}
