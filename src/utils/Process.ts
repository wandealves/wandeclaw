import { execFile } from 'node:child_process';

export type ProcessFailure = 'not_found' | 'timeout' | 'failed';

export interface ProcessOptions {
  /** Conteúdo enviado ao stdin (evita o limite de tamanho de argumentos). */
  input?: string;
  cwd?: string;
  /** Variáveis extras, somadas ao ambiente atual. */
  env?: Record<string, string>;
}

export class ProcessError extends Error {
  constructor(
    readonly command: string,
    readonly reason: ProcessFailure,
    message: string,
    /** Saída padrão até a falha (algumas CLIs reportam o erro em JSON no stdout). */
    readonly stdout = '',
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

/**
 * Executa um binário externo (sem shell) com timeout; o processo é morto se estourar.
 */
export function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  options: ProcessOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : undefined,
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr });

        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new ProcessError(command, 'not_found', `Comando "${command}" não encontrado no PATH.`));
        } else if (error.killed) {
          reject(new ProcessError(command, 'timeout', `"${command}" excedeu ${timeoutMs}ms e foi encerrado.`, String(stdout)));
        } else {
          const detail = String(stderr).trim().split('\n').slice(-3).join(' | ');
          reject(new ProcessError(command, 'failed', `"${command}" falhou (código ${error.code}): ${detail}`, String(stdout)));
        }
      },
    );
    // Sem input o stdin é fechado na hora: algumas CLIs esperam o EOF antes de começar.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(options.input ?? '');
  });
}
