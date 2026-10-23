import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonSchemaObject } from '../../llm/types.js';
import { ToolArgs, ToolResult } from '../BaseTool.js';
import { WorkspaceTool } from './WorkspaceTool.js';

const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_READ_CHARS = 100_000;

export class WriteFileTool extends WorkspaceTool {
  readonly name = 'write_file';
  readonly description =
    'Cria ou sobrescreve um arquivo de texto no workspace local do agente. Use caminhos relativos (ex.: "notas/ideias.md").';
  readonly parameters: JsonSchemaObject = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Caminho relativo ao workspace.' },
      content: { type: 'string', description: 'Conteúdo completo do arquivo.' },
    },
    required: ['path', 'content'],
  };

  protected async run(args: ToolArgs): Promise<ToolResult> {
    const content = String(args.content);
    if (Buffer.byteLength(content) > MAX_WRITE_BYTES) throw new Error('Conteúdo excede o limite de 1MB.');

    const fullPath = this.sandbox.resolve(String(args.path));
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
    return { output: `Arquivo "${this.sandbox.relative(fullPath)}" salvo (${content.length} caracteres).` };
  }
}

export class ReadFileTool extends WorkspaceTool {
  readonly name = 'read_file';
  readonly description = 'Lê um arquivo de texto do workspace local do agente.';
  readonly parameters: JsonSchemaObject = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Caminho relativo ao workspace.' },
    },
    required: ['path'],
  };

  protected async run(args: ToolArgs): Promise<ToolResult> {
    const fullPath = this.sandbox.resolve(String(args.path));
    const content = await fs.readFile(fullPath, 'utf8');
    if (content.length <= MAX_READ_CHARS) return { output: content };
    return { output: `${content.slice(0, MAX_READ_CHARS)}\n\n[... arquivo truncado em ${MAX_READ_CHARS} caracteres]` };
  }
}

export class ListFilesTool extends WorkspaceTool {
  readonly name = 'list_files';
  readonly description = 'Lista arquivos e pastas de um diretório do workspace local do agente.';
  readonly parameters: JsonSchemaObject = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Diretório relativo ao workspace. Padrão: raiz (".").' },
    },
  };

  protected async run(args: ToolArgs): Promise<ToolResult> {
    const fullPath = this.sandbox.resolve(typeof args.path === 'string' && args.path ? args.path : '.');
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    if (entries.length === 0) return { output: 'Diretório vazio.' };
    const lines = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `${entry.isDirectory() ? '[dir] ' : '      '}${entry.name}`);
    return { output: lines.join('\n') };
  }
}
