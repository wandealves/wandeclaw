import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider.js';

export class DeepSeekProvider extends OpenAICompatibleProvider {
  readonly name = 'deepseek';
  protected readonly baseUrl = 'https://api.deepseek.com';
}
