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
  readonly agentName: string;
  readonly maxIterations: number;
  readonly memoryWindowSize: number;
  readonly dbPath: string;
  readonly tmpDir: string;
  readonly skillsDir: string;
  readonly workspaceDir: string;

  private constructor(private readonly env: NodeJS.ProcessEnv) {
    this.telegramBotToken = this.required('TELEGRAM_BOT_TOKEN');
    this.allowedUserIds = Config.parseUserIds(this.required('TELEGRAM_ALLOWED_USER_IDS'));
    this.llmProvider = (env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
    this.fallbackProviders = Config.parseList(env.LLM_FALLBACK_PROVIDERS);
    this.routerProvider = env.ROUTER_PROVIDER?.trim().toLowerCase() || null;
    this.llmTimeoutMs = Config.positiveInt(env.LLM_TIMEOUT_MS, 120_000);
    this.agentName = env.AGENT_NAME?.trim() || 'WandeClaw';
    // EC-03 (agent-loop): sem MAX_ITERATIONS válido, o fallback é 5.
    this.maxIterations = Config.positiveInt(env.MAX_ITERATIONS, 5);
    this.memoryWindowSize = Config.positiveInt(env.MEMORY_WINDOW_SIZE, 20);
    this.dbPath = path.resolve(env.DB_PATH || './data/sandecoclaw.db');
    this.tmpDir = path.resolve(env.TMP_DIR || './tmp');
    this.skillsDir = path.resolve(env.SKILLS_DIR || './.agents/skills');
    this.workspaceDir = path.resolve(env.WORKSPACE_DIR || './workspace');
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

  private static positiveInt(raw: string | undefined, fallback: number): number {
    const value = Number.parseInt(raw ?? '', 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
