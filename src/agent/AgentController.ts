import { AllProvidersFailedError, LlmProviderError } from '../llm/types.js';
import { MemoryManager } from '../memory/MemoryManager.js';
import { SkillExecutor } from '../skills/SkillExecutor.js';
import { SkillLoader, SkillMetadata } from '../skills/SkillLoader.js';
import { SkillRouter } from '../skills/SkillRouter.js';
import { Logger } from '../utils/Logger.js';
import { MaxIterationsError } from './AgentLoop.js';

export interface AgentReply {
  text: string;
  isError: boolean;
  /** Enviar como mensagem de voz (TTS). */
  isAudio: boolean;
}

export interface MessageOptions {
  /** Entrada veio de voz ou o usuário pediu resposta falada (RF-06). */
  requiresAudioReply?: boolean;
}

const logger = new Logger('AgentController');

/**
 * Facade do pipeline: memória → skills (loader/router/executor) → AgentLoop → memória.
 */
export class AgentController {
  constructor(
    private readonly memory: MemoryManager,
    private readonly skillLoader: SkillLoader,
    private readonly skillRouter: SkillRouter,
    private readonly skillExecutor: SkillExecutor,
    private readonly voiceId: string,
  ) {}

  async handleMessage(userId: string, text: string, options: MessageOptions = {}): Promise<AgentReply> {
    const audioReply = options.requiresAudioReply ?? false;
    this.memory.addMessage(
      userId,
      'user',
      text,
      audioReply ? { requires_audio_reply: true, voice_id: this.voiceId } : undefined,
    );

    try {
      const skills = this.skillLoader.loadAll();
      const skillName = await this.skillRouter.route(text, skills);
      logger.info(skillName ? `Router escolheu a skill "${skillName}".` : 'Router: nenhuma skill (chat livre).');

      const answer = await this.skillExecutor.execute({
        history: this.memory.getContextWindow(userId),
        availableSkills: skills,
        skillName,
        audioReply,
        onObservation: ({ toolCallId, name, arguments: args, output }) =>
          this.memory.addMessage(userId, 'tool', output, { tool_call_id: toolCallId, name, arguments: args }),
      });
      this.memory.addMessage(userId, 'assistant', answer);
      return { text: answer, isError: false, isAudio: audioReply };
    } catch (error) {
      return { text: this.describeFailure(error), isError: true, isAudio: false };
    }
  }

  startNewConversation(userId: string): void {
    this.memory.startNewConversation(userId);
  }

  listSkills(): SkillMetadata[] {
    return this.skillLoader.loadAll();
  }

  /** Mensagem segura para o usuário: nunca expõe stack, chaves ou caminhos internos. */
  private describeFailure(error: unknown): string {
    if (error instanceof MaxIterationsError) {
      logger.warn(error.message);
      return `Desculpe, desisti do processamento: atingi o limite de ${error.maxIterations} iterações sem chegar a uma resposta.`;
    }
    if (error instanceof AllProvidersFailedError) {
      return `API Provider ${error.providers.join(', ')} falhou. Tente novamente em instantes.`;
    }
    if (error instanceof LlmProviderError) {
      logger.error('Falha no provedor de LLM', error);
      return `API Provider ${error.provider} falhou. Tente novamente em instantes.`;
    }
    logger.error('Erro inesperado no pipeline', error);
    return 'Erro interno ao processar sua mensagem.';
  }
}
