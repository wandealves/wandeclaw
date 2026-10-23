import { autoRetry } from '@grammyjs/auto-retry';
import { Bot } from 'grammy';
import { AgentController } from './agent/AgentController.js';
import { AgentLoop } from './agent/AgentLoop.js';
import { SystemPromptBuilder } from './agent/SystemPromptBuilder.js';
import { Config } from './config/Config.js';
import { DependencyChecker } from './diagnostics/DependencyChecker.js';
import { ProviderFactory } from './llm/ProviderFactory.js';
import { AudioConverter } from './media/AudioConverter.js';
import { DocumentExtractor } from './media/DocumentExtractor.js';
import { SpeechToTextFactory } from './media/SpeechToText.js';
import { TextToSpeechFactory } from './media/TextToSpeech.js';
import { ConversationRepository } from './memory/ConversationRepository.js';
import { DatabaseConnection } from './memory/DatabaseConnection.js';
import { DatabaseMaintenance } from './memory/DatabaseMaintenance.js';
import { MemoryManager } from './memory/MemoryManager.js';
import { MessageRepository } from './memory/MessageRepository.js';
import { SkillExecutor } from './skills/SkillExecutor.js';
import { SkillLoader } from './skills/SkillLoader.js';
import { SkillRouter } from './skills/SkillRouter.js';
import { TelegramFileDownloader } from './telegram/TelegramFileDownloader.js';
import { TelegramInputHandler } from './telegram/TelegramInputHandler.js';
import { TelegramOutputHandler } from './telegram/TelegramOutputHandler.js';
import { ToolFactory } from './tools/ToolFactory.js';
import { Logger } from './utils/Logger.js';
import { TempFiles } from './utils/TempFiles.js';

const logger = new Logger('Main');

async function main(): Promise<void> {
  const config = Config.get();

  const llmChain = [...new Set([config.llmProvider, ...config.fallbackProviders])];
  if (llmChain.length < 2) {
    logger.warn(`Sem fallback efetivo para "${config.llmProvider}": defina em LLM_FALLBACK_PROVIDERS um provedor diferente do principal.`);
  }

  const dependencies = DependencyChecker.fromConfig(config, llmChain);
  const startupStatus = await dependencies.check();
  for (const status of startupStatus) {
    if (status.ok) logger.info(`✅ ${status.purpose}: ${status.detail}`);
    else logger.warn(`${status.purpose}: ${status.detail}`);
  }
  // Se toda a cadeia de LLM depende de CLIs ausentes, o agente não tem como raciocinar.
  const missing = new Set(startupStatus.filter((status) => !status.ok).map((status) => status.purpose));
  if (llmChain.every((name) => ProviderFactory.isCliProvider(name) && missing.has(`LLM ${name}`))) {
    throw new Error(`Nenhum provedor de LLM utilizável: CLI(s) ausente(s) para ${llmChain.join(', ')}.`);
  }

  const providers = new ProviderFactory(config);
  const llm = providers.createWithFallback(llmChain);
  const routerLlm = config.routerProvider
    ? providers.createWithFallback([config.routerProvider, config.llmProvider])
    : llm;
  logger.info(`LLM: ${llm.name} | Router: ${routerLlm.name}`);

  const tmp = new TempFiles(config.tmpDir);
  tmp.purgeLeftovers();

  const db = DatabaseConnection.getInstance(config.dbPath);
  new DatabaseMaintenance(db, config.dbBackupDir, config.dbBackupKeep).schedule();
  const memory = new MemoryManager(
    new ConversationRepository(db),
    new MessageRepository(db),
    config.memoryWindowSize,
    config.llmProvider,
  );

  const registry = ToolFactory.createRegistry(config);
  const agentLoop = new AgentLoop(llm, registry, new SystemPromptBuilder(config.agentName), config.maxIterations);
  const skillLoader = new SkillLoader(config.skillsDir);
  const controller = new AgentController(
    memory,
    skillLoader,
    new SkillRouter(routerLlm),
    new SkillExecutor(agentLoop),
    config.ttsVoice,
  );
  const converter = new AudioConverter(config.ffmpegPath);
  logger.info(`STT: whisper (${config.whisperBackend}) | TTS: edge-tts ${config.ttsBackend} (${config.ttsVoice})`);

  const bot = new Bot(config.telegramBotToken);
  bot.api.config.use(autoRetry());
  const output = new TelegramOutputHandler(tmp, TextToSpeechFactory.create(config, tmp), converter);
  const statusReport = async () =>
    [
      `🤖 ${config.agentName}`,
      `LLM: ${llm.name}`,
      `Router: ${routerLlm.name}`,
      `Skills: ${skillLoader.loadAll().length} instalada(s)`,
      '',
      'Dependências:',
      DependencyChecker.format(await dependencies.check()),
    ].join('\n');
  const media = {
    downloader: new TelegramFileDownloader(bot.api, config.telegramBotToken, tmp),
    documents: new DocumentExtractor(config.maxDocumentBytes),
    speechToText: SpeechToTextFactory.create(config, tmp, converter),
    tmp,
    maxDocumentBytes: config.maxDocumentBytes,
  };
  new TelegramInputHandler(bot, config.allowedUserIds, controller, output, media, statusReport).register();
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
