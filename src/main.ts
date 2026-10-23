import { autoRetry } from '@grammyjs/auto-retry';
import { Bot } from 'grammy';
import { AgentController } from './agent/AgentController.js';
import { AgentLoop } from './agent/AgentLoop.js';
import { SystemPromptBuilder } from './agent/SystemPromptBuilder.js';
import { Config } from './config/Config.js';
import { ProviderFactory } from './llm/ProviderFactory.js';
import { ConversationRepository } from './memory/ConversationRepository.js';
import { DatabaseConnection } from './memory/DatabaseConnection.js';
import { MemoryManager } from './memory/MemoryManager.js';
import { MessageRepository } from './memory/MessageRepository.js';
import { SkillExecutor } from './skills/SkillExecutor.js';
import { SkillLoader } from './skills/SkillLoader.js';
import { SkillRouter } from './skills/SkillRouter.js';
import { TelegramInputHandler } from './telegram/TelegramInputHandler.js';
import { TelegramOutputHandler } from './telegram/TelegramOutputHandler.js';
import { ToolFactory } from './tools/ToolFactory.js';
import { Logger } from './utils/Logger.js';

const logger = new Logger('Main');

async function main(): Promise<void> {
  const config = Config.get();

  const providers = new ProviderFactory(config);
  const llm = providers.createWithFallback([config.llmProvider, ...config.fallbackProviders]);
  const routerLlm = config.routerProvider
    ? providers.createWithFallback([config.routerProvider, config.llmProvider])
    : llm;
  logger.info(`LLM: ${llm.name} | Router: ${routerLlm.name}`);

  const db = DatabaseConnection.getInstance(config.dbPath);
  const memory = new MemoryManager(
    new ConversationRepository(db),
    new MessageRepository(db),
    config.memoryWindowSize,
    config.llmProvider,
  );

  const registry = ToolFactory.createRegistry(config);
  const agentLoop = new AgentLoop(llm, registry, new SystemPromptBuilder(config.agentName), config.maxIterations);
  const controller = new AgentController(
    memory,
    new SkillLoader(config.skillsDir),
    new SkillRouter(routerLlm),
    new SkillExecutor(agentLoop),
  );

  const bot = new Bot(config.telegramBotToken);
  bot.api.config.use(autoRetry());
  new TelegramInputHandler(bot, config.allowedUserIds, controller, new TelegramOutputHandler(config.tmpDir)).register();
  bot.catch((err) => logger.error(`Erro no update ${err.ctx.update.update_id}`, err.error));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} recebido, encerrando...`);
    await bot.stop();
    DatabaseConnection.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => logger.info(`🤖 @${info.username} online (${config.agentName}). Aguardando mensagens...`),
  });
}

main().catch((error) => {
  logger.error('Falha fatal na inicialização', error);
  DatabaseConnection.close();
  process.exit(1);
});
