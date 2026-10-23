import fs from 'node:fs';
import { AgentLoop, ToolObservation } from '../agent/AgentLoop.js';
import { ChatMessage } from '../llm/types.js';
import { Logger } from '../utils/Logger.js';
import { SkillLoader, SkillMetadata } from './SkillLoader.js';

export interface ActiveSkill {
  name: string;
  content: string;
}

export interface SkillExecutionInput {
  history: ChatMessage[];
  availableSkills: SkillMetadata[];
  skillName: string | null;
  audioReply?: boolean;
  onObservation?: (observation: ToolObservation) => void;
}

const logger = new Logger('SkillExecutor');

/**
 * Carrega a instrução completa da skill escolhida e a injeta no AgentLoop
 * apenas durante esta requisição (runtime injection).
 */
export class SkillExecutor {
  constructor(private readonly agentLoop: AgentLoop) {}

  async execute(input: SkillExecutionInput): Promise<string> {
    const skill = this.loadSkill(input.skillName, input.availableSkills);
    return this.agentLoop.run({
      history: input.history,
      availableSkills: input.availableSkills,
      skill,
      audioReply: input.audioReply,
      onObservation: input.onObservation,
    });
  }

  private loadSkill(skillName: string | null, skills: SkillMetadata[]): ActiveSkill | null {
    const metadata = skills.find((skill) => skill.name === skillName);
    if (!metadata) return null;
    try {
      const parsed = SkillLoader.parse(fs.readFileSync(metadata.filePath, 'utf8'));
      if (!parsed) return null;
      logger.info(`Skill "${parsed.name}" injetada (${parsed.body.length} caracteres).`);
      return { name: parsed.name, content: parsed.body };
    } catch (error) {
      logger.error(`Falha ao ler a skill "${metadata.name}"`, error);
      return null;
    }
  }
}
