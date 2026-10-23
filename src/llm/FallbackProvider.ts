import { Logger } from '../utils/Logger.js';
import { AllProvidersFailedError, ChatMessage, ChatOptions, ILlmProvider, LlmResponse } from './types.js';

const logger = new Logger('Fallback');

/**
 * Tenta os provedores em ordem; se o principal falhar (ex.: 503), usa o próximo.
 */
export class FallbackProvider implements ILlmProvider {
  readonly name: string;

  constructor(private readonly providers: ILlmProvider[]) {
    if (providers.length === 0) throw new Error('FallbackProvider exige ao menos um provedor.');
    this.name = providers.map((provider) => provider.name).join(' → ');
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LlmResponse> {
    for (const provider of this.providers) {
      try {
        return await provider.chat(messages, options);
      } catch (error) {
        logger.error(`Provider "${provider.name}" falhou`, error);
      }
    }
    throw new AllProvidersFailedError(this.providers.map((provider) => provider.name));
  }
}
