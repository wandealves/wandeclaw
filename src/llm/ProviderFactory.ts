import { Config } from '../config/Config.js';
import { Logger } from '../utils/Logger.js';
import { FallbackProvider } from './FallbackProvider.js';
import { DeepSeekProvider } from './providers/DeepSeekProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';
import { GroqProvider } from './providers/GroqProvider.js';
import { ILlmProvider } from './types.js';

type ProviderConstructor = new (apiKey: string, model: string, timeoutMs: number) => ILlmProvider;

interface ProviderPreset {
  ctor: ProviderConstructor;
  apiKeyEnv: string;
  modelEnv: string;
  defaultModel: string;
}

const logger = new Logger('ProviderFactory');

/**
 * Factory dos "cérebros" do agente. Trocar `LLM_PROVIDER` no `.env` troca o provedor.
 */
export class ProviderFactory {
  private static readonly presets: Record<string, ProviderPreset> = {
    gemini: { ctor: GeminiProvider, apiKeyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-2.5-flash' },
    deepseek: { ctor: DeepSeekProvider, apiKeyEnv: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-chat' },
    groq: { ctor: GroqProvider, apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile' },
  };

  constructor(private readonly config: Config) {}

  static availableProviders(): string[] {
    return Object.keys(ProviderFactory.presets);
  }

  create(name: string): ILlmProvider {
    const preset = ProviderFactory.presets[name];
    if (!preset) {
      throw new Error(`Provedor "${name}" desconhecido. Disponíveis: ${ProviderFactory.availableProviders().join(', ')}`);
    }
    const apiKey = this.config.value(preset.apiKeyEnv);
    if (!apiKey) throw new Error(`Provedor "${name}" sem ${preset.apiKeyEnv} configurada no .env`);

    const model = this.config.value(preset.modelEnv) ?? preset.defaultModel;
    return new preset.ctor(apiKey, model, this.config.llmTimeoutMs);
  }

  /**
   * Cria o provedor principal com fallback em cascata. Provedores mal configurados
   * são ignorados com aviso; se nenhum restar, a inicialização falha.
   */
  createWithFallback(names: string[]): ILlmProvider {
    const providers: ILlmProvider[] = [];
    for (const name of new Set(names)) {
      try {
        providers.push(this.create(name));
      } catch (error) {
        logger.error(`Ignorando provedor "${name}"`, error);
      }
    }
    if (providers.length === 0) {
      throw new Error(`Nenhum provedor de LLM utilizável entre: ${names.join(', ')}`);
    }
    return providers.length === 1 ? providers[0] : new FallbackProvider(providers);
  }
}
