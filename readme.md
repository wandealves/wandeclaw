# WandeClaw

26:14

Agente pessoal de IA que roda localmente e é controlado pelo Telegram. Implementação das specs do
[SandeClaw](https://github.com/sandeco/prompts/tree/main/SandeClaw/specs) (cópia local em `specs/`).

## Como rodar

```bash
npm install
cp .env.example .env   # preencha TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_IDS e ao menos uma API key
npm run dev
```

- Token do bot: crie com o [@BotFather](https://t.me/BotFather).
- Seu user ID: pergunte ao [@userinfobot](https://t.me/userinfobot).
- Provedores: `gemini`, `deepseek` e `groq` (troque em `LLM_PROVIDER`; `LLM_FALLBACK_PROVIDERS` define a cascata em caso de falha).

Comandos no chat: `/start`, `/novo` (nova conversa) e `/skills` (lista as skills).

## Arquitetura

```
Telegram ─► TelegramInputHandler (whitelist) ─► AgentController (Facade)
                                                  ├─ MemoryManager ─► Conversation/MessageRepository ─► SQLite (WAL)
                                                  ├─ SkillLoader ─► SkillRouter (passo zero) ─► SkillExecutor
                                                  └─► AgentLoop (ReAct) ◄─► ToolRegistry / ProviderFactory
                                                          └─► TelegramOutputHandler (Text | File | Error)
```

| Pasta | Conteúdo |
|-------|----------|
| `src/agent` | `AgentController`, `AgentLoop` (ReAct, limite `MAX_ITERATIONS`), `SystemPromptBuilder` |
| `src/llm` | `ProviderFactory`, `FallbackProvider` e provedores compatíveis com a API OpenAI |
| `src/skills` | Loader (hot-reload), Router e Executor |
| `src/tools` | `BaseTool`, `ToolRegistry`, `ToolFactory` e tools (data/hora, ler/escrever/listar arquivos no `workspace/`) |
| `src/memory` | Singleton do SQLite, repositórios e `MemoryManager` (janela `MEMORY_WINDOW_SIZE`) |
| `src/telegram` | Input/Output handlers e estratégias de saída |

## Skills

Cada skill é uma pasta em `.agents/skills/<nome>/SKILL.md` com frontmatter YAML:

```markdown
---
name: minha-skill
description: Quando usar esta skill (é o que o Router enxerga).
---
Instruções detalhadas, injetadas no prompt só quando a skill é escolhida.
```

As skills são relidas a cada mensagem, então criar ou editar uma não exige reiniciar o bot.

## Arquivos na resposta

Quando o LLM responde com `<arquivo nome="x.md">...</arquivo>`, o conteúdo é enviado como documento no Telegram.

## Testes

```bash
npm test
npm run typecheck
```
