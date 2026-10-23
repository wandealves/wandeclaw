import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { ConversationRepository } from '../src/memory/ConversationRepository.js';
import { DatabaseConnection } from '../src/memory/DatabaseConnection.js';
import { MemoryManager } from '../src/memory/MemoryManager.js';
import { MessageRepository } from '../src/memory/MessageRepository.js';

const db = DatabaseConnection.getInstance(':memory:');
const memory = new MemoryManager(new ConversationRepository(db), new MessageRepository(db), 4, 'gemini');
after(() => DatabaseConnection.close());

test('persiste mensagens e devolve só a janela recente, começando por "user"', () => {
  for (let i = 1; i <= 3; i++) {
    memory.addMessage('42', 'user', `pergunta ${i}`);
    memory.addMessage('42', 'assistant', `resposta ${i}`);
  }
  const window = memory.getContextWindow('42');
  assert.deepEqual(window.map((message) => message.content), ['pergunta 2', 'resposta 2', 'pergunta 3', 'resposta 3']);
});

test('remove null bytes do conteúdo', () => {
  memory.addMessage('7', 'user', 'oi\u0000 agente');
  assert.equal(memory.getContextWindow('7')[0].content, 'oi agente');
});

test('/novo inicia conversa vazia sem apagar o histórico', () => {
  memory.startNewConversation('42');
  assert.deepEqual(memory.getContextWindow('42'), []);
  const total = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
  assert.ok(total.n >= 6);
});
