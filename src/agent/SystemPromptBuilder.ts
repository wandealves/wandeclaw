import type { ActiveSkill } from '../skills/SkillExecutor.js';
import type { SkillMetadata } from '../skills/SkillLoader.js';

export interface PromptContext {
  availableSkills: SkillMetadata[];
  skill: ActiveSkill | null;
  toolNames: string[];
}

/**
 * Monta o System Prompt de cada execução do AgentLoop.
 */
export class SystemPromptBuilder {
  constructor(private readonly agentName: string) {}

  build(context: PromptContext): string {
    const now = new Date().toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
    const sections = [
      `Você é o ${this.agentName}, um agente pessoal de IA que roda localmente no computador do usuário e conversa com ele pelo Telegram.`,
      `Data e hora atuais: ${now}.`,
      [
        '## Como trabalhar',
        '- Raciocine passo a passo. Quando precisar de informação ou agir no ambiente, chame as ferramentas disponíveis em vez de supor.',
        '- Nunca afirme que executou algo sem ter chamado a ferramenta correspondente e recebido o resultado.',
        '- Se uma ferramenta retornar erro, leia a mensagem e corrija a chamada.',
        '- Responda em português do Brasil, de forma direta. Use texto simples (sem MarkdownV2 do Telegram).',
        `- Ferramentas disponíveis: ${context.toolNames.join(', ') || 'nenhuma'}.`,
      ].join('\n'),
      [
        '## Entrega de documentos',
        'Quando o usuário pedir um documento (spec, PRD, relatório, código longo etc.), entregue-o como arquivo, envolvendo o conteúdo completo assim:',
        '<arquivo nome="nome-do-arquivo.md">',
        'conteúdo completo do documento',
        '</arquivo>',
        'Fora do bloco, escreva apenas um resumo curto.',
      ].join('\n'),
      this.skillsSection(context.availableSkills),
    ];

    if (context.skill) {
      sections.push(
        [
          `## Skill ativa: ${context.skill.name}`,
          'Siga rigorosamente as instruções abaixo para atender esta solicitação:',
          '<skill>',
          context.skill.content,
          '</skill>',
        ].join('\n'),
      );
    }
    return sections.join('\n\n');
  }

  private skillsSection(skills: SkillMetadata[]): string {
    if (skills.length === 0) return '## Skills instaladas\nNenhuma.';
    const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`);
    return `## Skills instaladas (availableSkills)\n${lines.join('\n')}`;
  }
}
