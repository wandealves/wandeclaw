import { execFile } from 'node:child_process';

export type ProcessFailure = 'not_found' | 'timeout' | 'failed';

export class ProcessError extends Error {
  constructor(
    readonly command: string,
    readonly reason: ProcessFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

/**
 * Executa um binário externo (sem shell) com timeout; o processo é morto se estourar.
 */
export function runProcess(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout, stderr });

      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new ProcessError(command, 'not_found', `Comando "${command}" não encontrado no PATH.`));
      } else if (error.killed) {
        reject(new ProcessError(command, 'timeout', `"${command}" excedeu ${timeoutMs}ms e foi encerrado.`));
      } else {
        const detail = String(stderr).trim().split('\n').slice(-3).join(' | ');
        reject(new ProcessError(command, 'failed', `"${command}" falhou (código ${error.code}): ${detail}`));
      }
    });
  });
}
