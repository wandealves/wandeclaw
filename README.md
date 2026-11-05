# WandeClaw

Agente pessoal de IA que roda no seu computador e é controlado pelo Telegram. Você conversa por texto, voz ou
documentos, e ele responde usando o modelo de linguagem que você escolher. Suas conversas ficam em um banco SQLite
local.

É uma implementação das specs do [SandeClaw](https://github.com/sandeco/prompts/tree/main/SandeClaw/specs), com cópia
local em `specs/`.

## O que ele faz

- **Conversa com memória:** guarda o histórico em SQLite e usa as mensagens recentes como contexto.
- **Entende texto, voz, PDF e `.md`:** áudios são transcritos localmente com o Whisper.
- **Responde em voz:** devolve mensagens de voz quando você manda áudio ou pede resposta falada.
- **Usa skills:** escolhe sozinho a skill certa para revisar textos, traduzir, estudar, escrever specs e mais.
- **Entrega arquivos:** gera documentos e os envia no Telegram.
- **Publica no LinkedIn:** escreve o rascunho e publica no seu perfil depois do seu clique.
- **Aceita vários provedores de LLM:** Gemini, DeepSeek, Groq, Claude Code ou OpenCode, com fallback entre eles.
- **Só atende você:** quem não está na whitelist é ignorado.

## Como começar

### 1. Pré-requisitos

- Node.js 20 ou superior.
- Um bot do Telegram, criado com o [@BotFather](https://t.me/BotFather).
- Seu ID numérico do Telegram, que o [@userinfobot](https://t.me/userinfobot) informa.
- Um provedor de LLM: uma API key **ou** o Claude Code ou OpenCode instalado e autenticado.

### 2. Instalação

```bash
npm install
cp .env.example .env
```

### 3. Configuração mínima

Preencha no `.env` os dados do Telegram e um provedor. Exemplo com API key:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-seu-token
TELEGRAM_ALLOWED_USER_IDS=123456789
LLM_PROVIDER=gemini
GEMINI_API_KEY=sua-chave
```

Veja as outras opções em [Provedores de LLM](#provedores-de-llm) e a lista completa de variáveis no `.env.example`.

### 4. Execução

Rode os comandos sempre da raiz do projeto, porque os caminhos do `.env` são relativos à pasta atual.

```bash
# Desenvolvimento: reinicia ao alterar arquivos em src/
npm run dev

# Produção
npm run build
npm start
```

Quando o bot subir, o log mostra `🤖 @seu_bot online`. Mande `/status` no Telegram para conferir o provedor e as
dependências.

### 5. Voz (opcional)

Texto, PDF e `.md` funcionam sem nada extra. Para usar voz, instale no computador:

```bash
sudo apt install ffmpeg          # Windows: winget install ffmpeg
pip install openai-whisper edge-tts
```

| Recurso | Configuração |
|---------|--------------|
| Transcrição | `WHISPER_BACKEND=openai` usa o CLI `whisper`. `WHISPER_BACKEND=cpp` usa o `whisper-cli` do whisper.cpp, e `WHISPER_MODEL` passa a ser o caminho do modelo `.bin`. |
| Síntese de voz | `TTS_BACKEND=cli` (padrão) usa o CLI `edge-tts`. O backend `npm` existe, mas a v1.4.0 recebe 403 do serviço da Microsoft. |

Sem o Whisper, o bot avisa que não conseguiu inicializá-lo. Se a síntese de voz falhar, a resposta vem em texto.

## Como usar

Converse com o bot no Telegram como em qualquer chat. Não é preciso escolher uma skill: ela é selecionada pelo conteúdo
da mensagem.

### Comandos

| Comando | O que faz |
|---------|-----------|
| `/start` | Mostra a mensagem de boas-vindas |
| `/novo` | Inicia uma nova conversa; o histórico anterior fica salvo, mas sai do contexto |
| `/skills` | Lista as skills instaladas |
| `/status` | Mostra provedores, skills, LinkedIn e dependências |

### O que você pode enviar

| Entrada | Tratamento |
|---------|------------|
| Texto | Vai direto ao agente. Frases como "me responde em áudio" ou "fale comigo" pedem resposta em voz. |
| PDF ou `.md` | O texto é extraído e enviado ao agente com a legenda, até `MAX_DOCUMENT_MB`. Outros formatos recebem um aviso. |
| Voz ou áudio | É transcrito localmente, e a resposta volta como mensagem de voz, salvo se a legenda recusar o áudio. |

Arquivos baixados ou gerados ficam em `./tmp` só durante o processamento.

### Exemplos

```text
corrige esse parágrafo: nós vai no mercado
traduz pro inglês: bom dia, equipe
escreve um e-mail para o meu chefe pedindo folga na sexta
me explica o que é recursão
cria flashcards sobre fotossíntese
escreve um post para o linkedin sobre o que aprendi na pós
```

Você também pode enviar um PDF com a legenda "faz o fichamento desse artigo".

## Skills

| Skill | Para que serve | Entrega |
|-------|----------------|---------|
| `resumidor` | Resumir textos longos, notícias ou conversas | Mensagem |
| `revisor-texto` | Corrigir e melhorar um texto já escrito | Mensagem |
| `tradutor` | Traduzir entre português, inglês e outros idiomas | Mensagem |
| `redator-mensagens` | Escrever e-mails e mensagens profissionais do zero | Mensagem |
| `post-linkedin` | Escrever e ajustar posts para o LinkedIn | Rascunho com botões |
| `fichamento-academico` | Fichar artigos, teses e capítulos | Arquivo `.md` |
| `flashcards-quiz` | Criar flashcards e quizzes com gabarito | Arquivo `.md` |
| `tutor` | Ensinar um conceito passo a passo | Mensagem |
| `prd-manager` | Criar ou revisar PRDs e specs | Arquivo `.md` |
| `skill-creator` | Criar e melhorar skills | Varia |

### Criar uma skill

Crie `.agents/skills/<nome>/SKILL.md`:

```markdown
---
name: minha-skill
description: "Quando usar esta skill. É o único texto que o roteador enxerga."
---

Instruções injetadas no prompt quando a skill é escolhida.
```

As skills são relidas a cada mensagem, então criar ou editar uma não exige reiniciar o bot. Confira com `/skills`.

Alguns cuidados:

- **Use aspas na `description`.** Com YAML inválido, a skill é ignorada sem aviso no log.
- **Coloque tudo no `SKILL.md`.** Só o corpo desse arquivo vai para o prompt; `scripts/` e `references/` não são lidos.
- **Faça descrições específicas.** Cada mensagem aciona no máximo uma skill.
- **Entregue tudo em uma resposta.** O roteador vê só a mensagem atual, então um "continua" pode não reativar a skill.
- **Lembre que skill não executa nada sozinha.** Ela só adiciona instruções; o que o agente consegue fazer depende das
  ferramentas do provedor.

### Arquivos na resposta

Quando a resposta contém `<arquivo nome="x.md">...</arquivo>`, o conteúdo é enviado como documento no Telegram.

## Publicar no LinkedIn

A skill `post-linkedin` escreve o rascunho, e o bot o mostra com os botões **Publicar** e **Cancelar**. A publicação é
feita pelo próprio bot, sem passar pelo LLM, e nada sai sem o seu clique. O texto publicado é exatamente o que apareceu
no Telegram, então revise-o antes de confirmar. Esta versão publica texto, hashtags e links no corpo do post.

Para configurar:

1. Crie um app em [linkedin.com/developers](https://www.linkedin.com/developers/apps) e adicione os produtos
   *Share on LinkedIn* e *Sign In with LinkedIn using OpenID Connect*.
2. No [Token Generator](https://www.linkedin.com/developers/tools/oauth/token-generator), gere um token com
   `w_member_social`, `openid` e `profile`.
3. Descubra seu identificador e copie o campo `sub`:

   ```bash
   curl -H "Authorization: Bearer SEU_TOKEN" https://api.linkedin.com/v2/userinfo
   ```

4. Preencha o `.env` e reinicie o bot:

   ```bash
   LINKEDIN_ACCESS_TOKEN=SEU_TOKEN
   LINKEDIN_PERSON_URN=urn:li:person:SEU_SUB
   ```

Sem essas variáveis, o rascunho aparece sem botões. Para manter a integração:

- **Token:** vence em 60 dias. Gere outro, atualize o `.env` e reinicie o bot.
- **Versão da API:** quando a versão em uso for desativada, atualize `LINKEDIN_API_VERSION`.
- **Rascunhos:** valem por 24 horas e se perdem ao reiniciar o bot. Nada é publicado depois disso.
- **Falhas:** se o LinkedIn não confirmar a publicação, confira seu perfil antes de tentar de novo.

Publicar em página de empresa ainda não é suportado. Isso exige a Community Management API, que passa por aprovação do
LinkedIn.

## Provedores de LLM

Além de modelos via API key, o agente pode usar **agentes de linha de comando**, que aproveitam o login da própria CLI.

| `LLM_PROVIDER` | Tipo | Autenticação | Ferramentas |
|----------------|------|--------------|-------------|
| `gemini` | API | `GEMINI_API_KEY` | do agente (`src/tools`) |
| `deepseek` | API | `DEEPSEEK_API_KEY` | do agente (`src/tools`) |
| `groq` | API | `GROQ_API_KEY` | do agente (`src/tools`) |
| `claude-code` | CLI (`claude -p`) | login do Claude Code | nativas do Claude Code |
| `opencode` | CLI (`opencode run`) | `opencode auth login` | nativas do OpenCode |

Exemplos:

```bash
# Claude Code: instale em https://claude.com/claude-code e rode "claude" uma vez para fazer login
LLM_PROVIDER=claude-code
CLAUDE_CODE_MODEL=sonnet                           # opcional: sonnet | opus | haiku | id completo

# OpenCode: instale em https://opencode.ai, depois rode "opencode auth login"
LLM_PROVIDER=opencode
OPENCODE_MODEL=opencode/deepseek-v4.1-flash-free   # formato provider/model; liste com "opencode models"
```

### Fallback e roteador

- `LLM_FALLBACK_PROVIDERS` define a cascata usada se o principal falhar. Exemplo: `LLM_PROVIDER=deepseek` com
  `LLM_FALLBACK_PROVIDERS=claude-code,groq`. Use um provedor diferente do principal.
- `ROUTER_PROVIDER` define quem escolhe a skill. Com um provedor CLI, cada mensagem faz duas chamadas à CLI; para
  economizar, use um provedor via API, como `ROUTER_PROVIDER=groq`.

### Como os provedores CLI funcionam

- A CLI roda sem interface, com `WORKSPACE_DIR` como diretório de trabalho e timeout em `CLI_TIMEOUT_MS` (padrão: 5 min).
- Ela executa o próprio loop de ferramentas e devolve só a resposta final.
- O histórico, as skills e o system prompt vão junto em cada chamada.
- O roteador chama a CLI **sem ferramentas**: Claude Code com `--tools ""` e OpenCode com o agente `plan`.

## Segurança

- **Acesso:** só os IDs de `TELEGRAM_ALLOWED_USER_IDS` são atendidos, inclusive nos botões.
- **Segredos:** nunca versione o `.env`. Ele já está no `.gitignore`.
- **Ferramentas do agente:** nos provedores via API, os arquivos ficam restritos a `WORKSPACE_DIR`.
- **Token do LinkedIn:** não é repassado aos processos filhos. As demais variáveis do `.env` são.

### ⚠️ Provedores CLI

Com um provedor CLI, mensagens de quem está na whitelist fazem a CLI **ler e editar arquivos no `WORKSPACE_DIR`**.
Por padrão, **executar comandos fica bloqueado**:

- **Claude Code:** só as ferramentas de `CLAUDE_CODE_ALLOWED_TOOLS` ficam disponíveis (padrão:
  `Read,Edit,Write,Glob,Grep,WebSearch,WebFetch`). Com `CLAUDE_CODE_PERMISSION_MODE=dontAsk`, o resto é negado sem
  perguntar. Os servidores MCP do seu Claude Code não são carregados (`--strict-mcp-config`).
- **OpenCode:** as permissões de `OPENCODE_PERMISSIONS` (padrão: `bash=deny,external_directory=deny`) são injetadas via
  `OPENCODE_CONFIG_CONTENT`. `OPENCODE_AUTO_APPROVE=true` aprova automaticamente o que não estiver negado.

Só adicione `Bash` ou `bash=allow` se aceitar que comandos vindos do Telegram rodem no seu computador. Nesse caso, eles
também terão acesso ao token do bot e às chaves de API presentes no ambiente.

## Problemas comuns

| Sintoma | O que fazer |
|---------|-------------|
| O bot não responde | Confira se seu ID está em `TELEGRAM_ALLOWED_USER_IDS`; quem não está na lista é ignorado sem aviso. |
| Erro de conflito ao iniciar | Mantenha só uma instância do bot com o mesmo token. |
| Uma skill não aparece em `/skills` | Confira se a pasta tem `SKILL.md` e se o YAML é válido, com `name` e `description`. |
| Voz não funciona | Veja em `/status` qual dependência falta. |
| "API Provider ... falhou" | Confira as credenciais do provedor e configure um fallback. |
| Alterei o `.env` e nada mudou | Reinicie o bot: o `npm run dev` só observa `src/`. |
| O LinkedIn recusou o token | Ele provavelmente venceu. Gere outro, atualize o `.env` e reinicie. |

## Arquitetura

```text
Telegram ─► TelegramInputHandler (whitelist) ─► AgentController (Facade)
                                                  ├─ MemoryManager ─► Conversation/MessageRepository ─► SQLite (WAL)
                                                  ├─ SkillLoader ─► SkillRouter (passo zero) ─► SkillExecutor
                                                  └─► AgentLoop (ReAct) ◄─► ToolRegistry / ProviderFactory
                                                          └─► TelegramOutputHandler (Text | File | Audio | Error)
                                                                  └─► LinkedInDraftHandler ─► LinkedInClient
```

| Pasta | Conteúdo |
|-------|----------|
| `src/agent` | `AgentController`, `AgentLoop` (ReAct, limite `MAX_ITERATIONS`), `SystemPromptBuilder` |
| `src/config` | Leitura e validação das variáveis de ambiente |
| `src/diagnostics` | `DependencyChecker`, que verifica binários no início e no `/status` |
| `src/linkedin` | Cliente da API e rascunhos pendentes |
| `src/llm` | `ProviderFactory`, `FallbackProvider`, provedores compatíveis com a API OpenAI e provedores CLI (`src/llm/cli`) |
| `src/media` | Extração de PDF e `.md`, Whisper, Edge-TTS e conversões de áudio com ffmpeg |
| `src/memory` | SQLite, repositórios, `MemoryManager` (janela `MEMORY_WINDOW_SIZE`), backups diários e VACUUM quando compensa |
| `src/skills` | Loader com hot-reload, roteador e executor |
| `src/telegram` | Handlers de entrada e saída, botões do LinkedIn, downloader de anexos e estratégias de saída |
| `src/tools` | `BaseTool`, `ToolRegistry`, `ToolFactory` e tools de data/hora e de arquivos no `workspace/` |
| `.agents/skills` | Skills instaladas |
| `specs` | Especificações do projeto |

## Desenvolvimento

```bash
npm test            # testes
npm run typecheck   # verificação de tipos
```

## Licença

[MIT](LICENSE)
