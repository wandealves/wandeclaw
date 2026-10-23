import { ChatMessage, Role } from '../llm/types.js';
import { Logger } from '../utils/Logger.js';
import { Conversation, ConversationRepository } from './ConversationRepository.js';
import { MessageMetadata, MessageRepository } from './MessageRepository.js';

const MAX_MESSAGE_CHARS = 100_000;
/**
 * Só user/assistant voltam ao LLM: observações de tool ficam no histórico, mas sem
 * a mensagem de tool_calls correspondente seriam rejeitadas pela API.
 */
const CONTEXT_ROLES: Role[] = ['user', 'assistant'];
const logger = new Logger('MemoryManager');

/**
 * Facade da memória: persiste o histórico completo e entrega ao AgentLoop apenas
 * a janela recente (`MEMORY_WINDOW_SIZE`).
 */
export class MemoryManager {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly windowSize: number,
    private readonly providerName: string,
  ) {}

  addMessage(userId: string, role: Role, content: string, metadata?: MessageMetadata): void {
    try {
      const conversation = this.getOrCreateConversation(userId);
      this.messages.add(conversation.id, role, MemoryManager.sanitize(content), metadata);
      this.conversations.touch(conversation.id);
    } catch (error) {
      // EC-02 (PRD): banco ocupado/bloqueado não derruba o pipeline.
      logger.error('Falha ao persistir mensagem', error);
    }
  }

  getContextWindow(userId: string): ChatMessage[] {
    const conversation = this.getOrCreateConversation(userId);
    const recent = this.messages.findRecent(conversation.id, this.windowSize, CONTEXT_ROLES);

    // A janela deve começar por uma mensagem do usuário.
    const firstUser = recent.findIndex((message) => message.role === 'user');
    return firstUser === -1
      ? []
      : recent.slice(firstUser).map(({ role, content }) => ({ role, content }));
  }

  startNewConversation(userId: string): void {
    this.conversations.deactivateAllForUser(userId);
    this.conversations.create(userId, this.providerName);
  }

  private getOrCreateConversation(userId: string): Conversation {
    return this.conversations.findActiveByUser(userId) ?? this.conversations.create(userId, this.providerName);
  }

  private static sanitize(content: string): string {
    const clean = content.replace(/\u0000/g, '');
    return clean.length > MAX_MESSAGE_CHARS ? `${clean.slice(0, MAX_MESSAGE_CHARS)}\n[... truncado]` : clean;
  }
}
