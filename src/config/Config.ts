import 'dotenv/config';
import path from 'node:path';

/**
 * Configuração central do agente (Singleton), lida do `.env`.
 */
export class Config {
  private static instance: Config | null = null;

  readonly telegramBotToken: string;
  readonly allowedUserIds: ReadonlySet<number>;
  readonly llmProvider: string;
  readonly fallbackProviders: string[];
  readonly routerProvider: string | null;
  readonly llmTimeoutMs: number;
  readonly cliTimeoutMs: number;
  readonly claudeCode: { command: string; model?: string; allowedTools: string; permissionMode: string };
  readonly openCode: {
    command: string;
    model?: string;
    agent?: string;
    permissions: Record<string, string>;
    autoApprove: boolean;
  };
  readonly agentName: string;
  readonly maxIterations: number;
  readonly memoryWindowSize: number;
  readonly dbPath: string;
  readonly tmpDir: string;
  readonly skillsDir: string;
  readonly workspaceDir: string;
  readonly dbBackupDir: string;
  readonly dbBackupKeep: number;
  readonly maxDocumentBytes: number;
  readonly whisperBackend: string;
  readonly whisperCommand: string;
  readonly whisperModel: string;
  readonly whisperLanguage: string | null;
  readonly whisperTimeoutMs: number;
  readonly ffmpegPath: string;
  readonly ttsBackend: string;
  readonly ttsCommand: string;
  readonly ttsVoice: string;
  readonly ttsTimeoutMs: number;

  private constructor(private readonly env: NodeJS.ProcessEnv) {
    this.telegramBotToken = this.required('TELEGRAM_BOT_TOKEN');
    this.allowedUserIds = Config.parseUserIds(this.required('TELEGRAM_ALLOWED_USER_IDS'));
    this.llmProvider = (env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
    this.fallbackProviders = Config.parseList(env.LLM_FALLBACK_PROVIDERS);
    this.routerProvider = env.ROUTER_PROVIDER?.trim().toLowerCase() || null;
    this.llmTimeoutMs = Config.positiveInt(env.LLM_TIMEOUT_MS, 120_000);
    // Agentes CLI rodam o próprio loop de ferramentas: precisam de mais tempo.
    this.cliTimeoutMs = Config.positiveInt(env.CLI_TIMEOUT_MS, 300_000);
    this.claudeCode = {
      command: env.CLAUDE_CODE_COMMAND?.trim() || 'claude',
      model: env.CLAUDE_CODE_MODEL?.trim() || undefined,
      // Sem Bash por padrão: mensagens do Telegram não executam comandos no host.
      allowedTools: (env.CLAUDE_CODE_ALLOWED_TOOLS ?? 'Read,Edit,Write,Glob,Grep,WebSearch,WebFetch').replace(/\s+/g, ''),
      permissionMode: env.CLAUDE_CODE_PERMISSION_MODE?.trim() || 'dontAsk',
    };
    this.openCode = {
      command: env.OPENCODE_COMMAND?.trim() || 'opencode',
      model: env.OPENCODE_MODEL?.trim() || undefined,
      agent: env.OPENCODE_AGENT?.trim() || undefined,
      permissions: Config.parsePermissions(env.OPENCODE_PERMISSIONS),
      autoApprove: env.OPENCODE_AUTO_APPROVE?.trim().toLowerCase() === 'true',
    };
    this.agentName = env.AGENT_NAME?.trim() || 'WandeClaw';
    // EC-03 (agent-loop): sem MAX_ITERATIONS válido, o fallback é 5.
    this.maxIterations = Config.positiveInt(env.MAX_ITERATIONS, 5);
    this.memoryWindowSize = Config.positiveInt(env.MEMORY_WINDOW_SIZE, 20);
    this.dbPath = path.resolve(env.DB_PATH || './data/sandecoclaw.db');
    this.tmpDir = path.resolve(env.TMP_DIR || './tmp');
    this.skillsDir = path.resolve(env.SKILLS_DIR || './.agents/skills');
    this.workspaceDir = path.resolve(env.WORKSPACE_DIR || './workspace');
    this.dbBackupDir = path.resolve(env.DB_BACKUP_DIR || './data/backups');
    this.dbBackupKeep = Config.nonNegativeInt(env.DB_BACKUP_KEEP, 7);
    // Bots só podem baixar arquivos de até 20 MB pela Bot API.
    this.maxDocumentBytes = Math.min(Config.positiveInt(env.MAX_DOCUMENT_MB, 20), 20) * 1024 * 1024;
    this.whisperBackend = (env.WHISPER_BACKEND || 'openai').trim().toLowerCase();
    this.whisperCommand = env.WHISPER_COMMAND?.trim() || (this.whisperBackend === 'cpp' ? 'whisper-cli' : 'whisper');
    this.whisperModel = env.WHISPER_MODEL?.trim() || 'base';
    this.whisperLanguage = env.WHISPER_LANGUAGE?.trim() || null;
    this.whisperTimeoutMs = Config.positiveInt(env.WHISPER_TIMEOUT_MS, 60_000);
    this.ffmpegPath = env.FFMPEG_PATH?.trim() || 'ffmpeg';
    this.ttsBackend = (env.TTS_BACKEND || 'cli').trim().toLowerCase();
    this.ttsCommand = env.TTS_COMMAND?.trim() || 'edge-tts';
    this.ttsVoice = env.TTS_VOICE?.trim() || 'pt-BR-ThalitaMultilingualNeural';
    this.ttsTimeoutMs = Config.positiveInt(env.TTS_TIMEOUT_MS, 60_000);
  }

  static get(): Config {
    if (!Config.instance) Config.instance = new Config(process.env);
    return Config.instance;
  }

  /** Lê uma variável arbitrária (ex.: chaves de API de cada provedor). */
  value(name: string): string | undefined {
    const value = this.env[name]?.trim();
    return value ? value : undefined;
  }

  private required(name: string): string {
    const value = this.value(name);
    if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
    return value;
  }

  private static parseUserIds(raw: string): Set<number> {
    const ids = Config.parseList(raw).map(Number).filter(Number.isSafeInteger);
    if (ids.length === 0) throw new Error('TELEGRAM_ALLOWED_USER_IDS não contém nenhum ID numérico válido.');
    return new Set(ids);
  }

  private static parseList(raw: string | undefined): string[] {
    return (raw ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  /** Formato "bash=deny,edit=allow"; o padrão nega Bash e acesso fora do workspace. */
  private static parsePermissions(raw: string | undefined): Record<string, string> {
    const source = raw?.trim() || 'bash=deny,external_directory=deny';
    const rules: Record<string, string> = {};
    for (const pair of source.split(',')) {
      const [tool, action] = pair.split('=').map((part) => part?.trim());
      // "ask" não é aceito: em modo headless não há quem responda.
      if (tool && ['allow', 'deny'].includes(action ?? '')) rules[tool] = action!;
    }
    return rules;
  }

  private static nonNegativeInt(raw: string | undefined, fallback: number): number {
    const value = Number.parseInt(raw ?? '', 10);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  }

  private static positiveInt(raw: string | undefined, fallback: number): number {
    const value = Number.parseInt(raw ?? '', 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
