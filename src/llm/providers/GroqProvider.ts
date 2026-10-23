import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider.js';

export class GroqProvider extends OpenAICompatibleProvider {
  readonly name = 'groq';
  protected readonly baseUrl = 'https://api.groq.com/openai/v1';
}
