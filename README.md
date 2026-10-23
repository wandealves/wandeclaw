# WandeClaw

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

### Voz e documentos (opcional)

Texto, PDF e `.md` funcionam sem nada extra. Para voz, instale no host:

```bash
# ffmpeg: necessário para Whisper e para gerar a Voice Note (OGG/Opus)
sudo apt install ffmpeg          # Windows: winget install ffmpeg
pip install openai-whisper edge-tts
```

- **STT:** `WHISPER_BACKEND=openai` usa o CLI `whisper`; `WHISPER_BACKEND=cpp` usa o `whisper-cli` do whisper.cpp
  (nesse caso `WHISPER_MODEL` é o caminho do modelo `.bin`).
- **TTS:** `TTS_BACKEND=cli` (padrão) usa o CLI `edge-tts`. O backend `npm` (`edge-tts-universal`) está disponível, mas a
  v1.4.0 recebe 403 do serviço da Microsoft desde a mudança do token de autenticação.
- Sem Whisper o bot avisa "Não consegui inicializar o Whisper local agora."; se o TTS falhar, a resposta vai em texto.

Comandos no chat: `/start`, `/novo` (nova conversa) e `/skills` (lista as skills).

## Entradas e saídas

| Entrada | Tratamento |
|---------|------------|
| Texto | Vai direto ao agente. "me responde em áudio" / "fale comigo" pede resposta em voz. |
| PDF / `.md` (até `MAX_DOCUMENT_MB`) | Texto extraído (pdf-parse) e enviado junto com a legenda. Outros formatos recebem aviso. |
| Voz / áudio | Transcrito pelo Whisper local; a resposta volta como Voice Note (Edge-TTS, `pt-BR-ThalitaMultilingualNeural`). |

Arquivos baixados e gerados ficam em `./tmp` só durante o processamento. Na inicialização, sobras de execuções
interrompidas são removidas.

## Arquitetura

```
Telegram ─► TelegramInputHandler (whitelist) ─► AgentController (Facade)
                                                  ├─ MemoryManager ─► Conversation/MessageRepository ─► SQLite (WAL)
                                                  ├─ SkillLoader ─► SkillRouter (passo zero) ─► SkillExecutor
                                                  └─► AgentLoop (ReAct) ◄─► ToolRegistry / ProviderFactory
                                                          └─► TelegramOutputHandler (Text | File | Audio | Error)
```

| Pasta | Conteúdo |
|-------|----------|
| `src/agent` | `AgentController`, `AgentLoop` (ReAct, limite `MAX_ITERATIONS`), `SystemPromptBuilder` |
| `src/llm` | `ProviderFactory`, `FallbackProvider` e provedores compatíveis com a API OpenAI |
| `src/skills` | Loader (hot-reload), Router e Executor |
| `src/tools` | `BaseTool`, `ToolRegistry`, `ToolFactory` e tools (data/hora, ler/escrever/listar arquivos no `workspace/`) |
| `src/memory` | Singleton do SQLite, repositórios, `MemoryManager` (janela `MEMORY_WINDOW_SIZE`) e backups/VACUUM diários |
| `src/media` | Extração de PDF/MD, STT (Whisper), TTS (Edge-TTS) e conversões de áudio (ffmpeg) |
| `src/telegram` | Input/Output handlers, downloader de anexos e estratégias de saída |

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
