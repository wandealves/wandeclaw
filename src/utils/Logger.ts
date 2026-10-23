type Level = 'debug' | 'info' | 'warn' | 'error';

const COLORS: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

/**
 * Logger simples para stdout, com escopo por módulo.
 */
export class Logger {
  constructor(private readonly scope: string) {}

  debug(message: string): void {
    if (process.env.LOG_LEVEL === 'debug') this.write('debug', message);
  }

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  error(message: string, error?: unknown): void {
    this.write('error', error ? `${message} — ${errorMessage(error)}` : message);
  }

  private write(level: Level, message: string): void {
    const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const line = `${COLORS[level]}[${time}] ${level.toUpperCase().padEnd(5)} [${this.scope}]${RESET} ${message}`;
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Encurta textos longos para exibição no log. */
export function preview(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
