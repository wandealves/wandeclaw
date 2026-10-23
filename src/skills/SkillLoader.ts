import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { Logger } from '../utils/Logger.js';

export interface SkillMetadata {
  name: string;
  description: string;
  filePath: string;
}

export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;
const logger = new Logger('SkillLoader');

/**
 * Lê `.agents/skills/<pasta>/SKILL.md` de forma síncrona a cada requisição,
 * o que dá hot-reload sem reiniciar o processo.
 */
export class SkillLoader {
  constructor(private readonly skillsDir: string) {}

  loadAll(): SkillMetadata[] {
    if (!fs.existsSync(this.skillsDir)) return [];

    const skills = new Map<string, SkillMetadata>();
    for (const entry of fs.readdirSync(this.skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const filePath = path.join(this.skillsDir, entry.name, 'SKILL.md');
      // EC-02: pasta sem SKILL.md é ignorada silenciosamente.
      if (!fs.existsSync(filePath)) continue;

      const parsed = SkillLoader.parse(fs.readFileSync(filePath, 'utf8'));
      // EC-03: frontmatter inválido rejeita só esta skill.
      if (!parsed) continue;

      // EC-01: nome duplicado — a última pasta lida substitui a anterior.
      if (skills.has(parsed.name)) logger.warn(`Skill duplicada "${parsed.name}" em "${entry.name}" substitui a anterior.`);
      skills.set(parsed.name, { name: parsed.name, description: parsed.description, filePath });
    }
    return [...skills.values()];
  }

  /** Separa o frontmatter YAML do corpo Markdown. Retorna `null` se inválido. */
  static parse(raw: string): ParsedSkill | null {
    const match = FRONTMATTER.exec(raw);
    if (!match) return null;
    try {
      const meta = load(match[1]) as Record<string, unknown> | null;
      const name = typeof meta?.name === 'string' ? meta.name.trim() : '';
      const description = typeof meta?.description === 'string' ? meta.description.trim() : '';
      if (!name || !description) return null;
      return { name, description, body: (match[2] ?? '').trim() };
    } catch {
      return null;
    }
  }
}
