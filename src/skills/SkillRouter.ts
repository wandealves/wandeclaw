import { ILlmProvider } from '../llm/types.js';
import { Logger } from '../utils/Logger.js';
import { SkillMetadata } from './SkillLoader.js';

const logger = new Logger('SkillRouter');

/**
 * "Passo zero": uma chamada barata ao LLM, só com nome + descrição das skills,
 * para decidir qual skill (se alguma) deve ser injetada no AgentLoop.
 */
export class SkillRouter {
  constructor(private readonly provider: ILlmProvider) {}

  async route(userMessage: string, skills: SkillMetadata[]): Promise<string | null> {
    if (skills.length === 0) return null;

    try {
      const response = await this.provider.chat(
        [
          { role: 'system', content: SkillRouter.buildPrompt(skills) },
          { role: 'user', content: userMessage },
        ],
        { temperature: 0 },
      );
      return SkillRouter.parseDecision(response.content, skills);
    } catch (error) {
      logger.error('Router falhou; seguindo sem skill', error);
      return null;
    }
  }

  static buildPrompt(skills: SkillMetadata[]): string {
    const catalog = skills.map(({ name, description }) => ({ name, description }));
    return [
      'Você é um roteador de intenções. Escolha no máximo UMA skill do catálogo que atenda à mensagem do usuário.',
      'Se nenhuma skill for claramente adequada (ex.: saudações, conversa casual, perguntas gerais), escolha null.',
      'Responda APENAS com JSON válido, sem texto adicional, exatamente neste formato:',
      '{"skillName": "<nome-da-skill>"} ou {"skillName": null}',
      '',
      `Catálogo de skills: ${JSON.stringify(catalog)}`,
    ].join('\n');
  }

  /** Qualquer erro de parse ou skill inexistente vira `null` (fallback para chat livre). */
  static parseDecision(raw: string | null, skills: SkillMetadata[]): string | null {
    const json = raw?.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    try {
      const skillName = (JSON.parse(json) as { skillName?: unknown }).skillName;
      if (typeof skillName !== 'string') return null;
      return skills.some((skill) => skill.name === skillName) ? skillName : null;
    } catch {
      return null;
    }
  }
}
