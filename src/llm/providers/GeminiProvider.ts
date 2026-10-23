import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider.js';

export class GeminiProvider extends OpenAICompatibleProvider {
  readonly name = 'gemini';
  protected readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
}
