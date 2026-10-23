import { Config } from '../config/Config.js';
import { DateTimeTool } from './implementations/DateTimeTool.js';
import { ListFilesTool, ReadFileTool, WriteFileTool } from './implementations/FileTools.js';
import { ToolRegistry } from './ToolRegistry.js';
import { WorkspaceSandbox } from './WorkspaceSandbox.js';

/**
 * Monta o registro com as ferramentas padrão do agente.
 */
export class ToolFactory {
  static createRegistry(config: Config): ToolRegistry {
    const sandbox = new WorkspaceSandbox(config.workspaceDir);
    return new ToolRegistry()
      .register(new DateTimeTool())
      .register(new WriteFileTool(sandbox))
      .register(new ReadFileTool(sandbox))
      .register(new ListFilesTool(sandbox));
  }
}
