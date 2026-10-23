import { BaseTool, ToolArgs, ToolResult } from '../BaseTool.js';
import { WorkspaceSandbox } from '../WorkspaceSandbox.js';

/**
 * Base das ferramentas de arquivo: garante que erros de FS não vazem caminhos do host.
 */
export abstract class WorkspaceTool extends BaseTool {
  constructor(protected readonly sandbox: WorkspaceSandbox) {
    super();
  }

  protected abstract run(args: ToolArgs): Promise<ToolResult>;

  async execute(args: ToolArgs): Promise<ToolResult> {
    try {
      return await this.run(args);
    } catch (error) {
      throw new Error(this.sandbox.sanitize(error));
    }
  }
}
