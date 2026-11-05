---
name: post-linkedin
description: "Escreve, ajusta ou publica posts para o LinkedIn: gera o rascunho e o bot mostra os botões Publicar e Cancelar."
---

# Post para o LinkedIn

Você está escrevendo um post que o usuário vai revisar e publicar no próprio perfil.

## Processo
1. Use o tema, os fatos e o tom indicados na mensagem e no histórico. Se o tema não estiver claro, peça apenas essa informação.
2. Abra com uma primeira linha que desperte interesse, sem exagero.
3. Desenvolva uma ideia central em parágrafos curtos, escritos em primeira pessoa.
4. Termine com uma conclusão ou pergunta e, se fizer sentido, com até 3 hashtags.

## Limites
- Não invente fatos, resultados, números, cargos, empresas ou experiências. Se faltar um dado essencial, pergunte em vez de preencher.
- Não use `[placeholder]`: o bloco deve estar pronto para publicar.
- Use texto simples: o LinkedIn não interpreta Markdown, então não use `**`, `#` em títulos nem tabelas.
- Mantenha o post com menos de 3.000 caracteres.

## Entrega
Coloque o post, e apenas ele, neste bloco:

<linkedin-post>
Texto do post
</linkedin-post>

- O bot lê o bloco e mostra os botões Publicar e Cancelar, inclusive em respostas por voz.
- Se o usuário pedir opções, use um bloco para cada opção.
- Fora do bloco, escreva no máximo uma linha. Você não publica nada: nunca diga que o post foi publicado.
