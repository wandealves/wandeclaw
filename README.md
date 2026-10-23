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
- Provedor de LLM: escolha em `LLM_PROVIDER`. Pode ser um modelo via API key **ou** um agente de linha de comando
  (Claude Code, OpenCode). Veja [Provedores de LLM](#provedores-de-llm).

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

Comandos no chat: `/start`, `/novo` (nova conversa), `/skills` (lista as skills) e `/status` (provedores e dependências).

Na inicialização o agente verifica os binários que a configuração usa (CLIs de LLM, Whisper, edge-tts, ffmpeg) e
loga ✅/⚠️ com a dica de instalação. O mesmo relatório aparece no `/status`.

## Provedores de LLM

Além de modelos via API key, o agente pode usar **agentes de linha de comando** como cérebro. Eles usam o login da
própria CLI, sem API key no `.env`.

| `LLM_PROVIDER` | Tipo | Autenticação | Ferramentas |
|----------------|------|--------------|-------------|
| `gemini` | API | `GEMINI_API_KEY` | do agente (`src/tools`) |
| `deepseek` | API | `DEEPSEEK_API_KEY` | do agente (`src/tools`) |
| `groq` | API | `GROQ_API_KEY` | do agente (`src/tools`) |
| `claude-code` | CLI (`claude -p`) | login do Claude Code (assinatura Claude ou a key configurada nele) | nativas do Claude Code |
| `opencode` | CLI (`opencode run`) | `opencode auth login` (qualquer provedor, inclusive modelos gratuitos) | nativas do OpenCode |

### Claude Code

```bash
# instale em https://claude.com/claude-code e rode "claude" uma vez para fazer login
LLM_PROVIDER=claude-code
CLAUDE_CODE_MODEL=sonnet                 # opcional: sonnet | opus | haiku | id completo
```

### OpenCode

```bash
# instale em https://opencode.ai, depois: opencode auth login  (e "opencode models" para listar)
LLM_PROVIDER=opencode
OPENCODE_MODEL=opencode/deepseek-v4.1-flash-free   # formato provider/model
```

### Como funciona

- A CLI roda em modo headless com o diretório de trabalho em `WORKSPACE_DIR`. Ela executa o próprio loop de
  ferramentas e devolve só a resposta final (timeout em `CLI_TIMEOUT_MS`, padrão 5 min).
- O histórico da conversa (memória SQLite), as skills e o system prompt do agente vão junto em cada chamada.
- O `SkillRouter` chama a CLI **sem ferramentas** (Claude Code com `--tools ""`, OpenCode com o agente `plan`).
  Para economizar, use um provedor via API como router: `ROUTER_PROVIDER=groq`.
- Dá para misturar na cascata, por exemplo `LLM_PROVIDER=deepseek` com `LLM_FALLBACK_PROVIDERS=claude-code,groq`.
  O agente avisa no log quando o fallback é vazio ou repete o provedor principal.

### ⚠️ Segurança das ferramentas nativas

Com um provedor CLI, mensagens do Telegram (apenas de quem está na whitelist) fazem a CLI **ler e editar arquivos
no `WORKSPACE_DIR`**. Por padrão, **executar comandos (Bash) fica bloqueado**:

- **Claude Code:** só as ferramentas de `CLAUDE_CODE_ALLOWED_TOOLS` ficam disponíveis (padrão
  `Read,Edit,Write,Glob,Grep,WebSearch,WebFetch`). Com `CLAUDE_CODE_PERMISSION_MODE=dontAsk`, o resto é negado sem
  perguntar. Servidores MCP do seu Claude Code não são carregados (`--strict-mcp-config`).
- **OpenCode:** as permissões de `OPENCODE_PERMISSIONS` (padrão `bash=deny,external_directory=deny`) são injetadas
  via `OPENCODE_CONFIG_CONTENT`. `OPENCODE_AUTO_APPROVE=true` aprova automaticamente o que não estiver negado.

Só adicione `Bash` (ou `bash=allow`) se aceitar que comandos vindos do Telegram rodem no seu computador.

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
| `src/llm` | `ProviderFactory`, `FallbackProvider`, provedores compatíveis com a API OpenAI e provedores CLI (`src/llm/cli`) |
| `src/diagnostics` | `DependencyChecker` (checagem de binários no startup e no `/status`) |
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
