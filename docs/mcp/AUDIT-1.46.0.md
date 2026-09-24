# Auditoria diferencial 1.42.0-mcp → upstream v1.46.0

Histórico: a candidata 1.46.0 passou pelo CI completo, mas a release oficial
1.47.0 chegou antes da publicação MCP. A integração prosseguiu em
[AUDIT-1.47.0.md](AUDIT-1.47.0.md); não existe release 1.46.0-mcp.

Estado: **integração candidata; publicação bloqueada**. A release oficial
[`v1.46.0`](https://github.com/melgarafael/DeskcommCRM/releases/tag/v1.46.0)
aponta para `d522966877e2557ec51c77ee9867121a821909f5`. A linha MCP pronta
permanece `v1.42.0-mcp`. A tag 1.46 inclui 1.43, 1.44 e 1.45; a auditoria
dessas mudanças está em [AUDIT-1.45.0.md](AUDIT-1.45.0.md). A diferença oficial
1.45 → 1.46 tem 103 arquivos; 1.42 → 1.46 tem 338.

## Detecção e integração

O detector do fork executou para 1.46 e encontrou seis conflitos ao mesclar a
tag sobre `mcp/stable`: agenda, envio de mensagens, início de conversa,
respectivos testes e `package.json`. Abriu a
[issue #4](https://github.com/lucascruzfl/DeskcommCRM/issues/4) e não publicou.
A [PR #5](https://github.com/lucascruzfl/DeskcommCRM/pull/5) preserva a resolução
humana da candidata 1.45 e integra a tag 1.46. Os quatro conflitos incrementais
foram resolvidos manualmente. O freio de envio da 1.46 acontece **dentro da
reserva idempotente, antes de abrir a conversa**: replay não debita ritmo, e
um 429 não deixa conversa vazia. Os testes focados de mensagem e agenda passaram
(32 testes), e o typecheck local passou antes da nova tool de continuidade.
O CI completo da PR precisa confirmar a versão final da branch.

## Classificação diferencial da 1.46

| Mudança | Classe | Cobertura/decisão |
| --- | --- | --- |
| Continuar atendimento pelo outro número conectado | A | `crm_continue_on_another_number` usa o mesmo serviço da tela, exige conversa e canal da organização, canal WORKING e sem envio implícito. A atribuição permanece na tool auditada `crm_assign_conversation`. |
| `crm_find_free_slots` com `dia` e `dias_a_frente` | A | A data específica prevalece; descrição e teste seguem a regra oficial. |
| Freio de envio antes da abertura e teto agregado por organização | A | MCP conserva reserva idempotente e usa canal antes da abertura; rota REST mantém teto por token e organização. |
| Correções de modelo Meta, vínculo por canal/idioma e envio de foto | A operacional | Mesmos serviços oficiais integrados; regressões de mensagem e canal precisam passar. |
| Salvar link público de mídia em template Meta | B | Configuração de canal externo por administrador; revisão humana do conteúdo e URL. Não é envio MCP. |
| `META_WEBHOOK_BASE_URL` opcional | B | Configuração do host/URL pública; instalação existente usa fallback. MCP não escreve configuração de servidor. |
| Correções de atribuição, dono de lead, webhook recusado e transcrição | A operacional | Código oficial integrado; invariantes de banco, auth, isolamento e testes de canal são gates. |
| Ajustes de UI, rolagem da agenda e quebra de linha no Inbox | A visual | Playwright/UI do projeto precisa passar; não muda o contrato MCP. |
| Credencial OpenRouter e extensões do servidor | B/C | Credencial e instalação de plataforma exigem pessoa autorizada; nenhuma saída de segredo. |

Nenhuma nova operação foi inferida a partir da contagem de tools. `tools/list` é a
fonte de verdade. O número é snapshot informativo no manifesto e não é gate.
Os gaps A identificados acima foram tratados na branch, mas o total **ainda é
indeterminado** até a auditoria final por operação e gates completos. Portanto
`RELEASE-AUDIT.json` continua em 1.42.0 e impede publicação.

O primeiro E2E da candidata encontrou dois defeitos adicionais: a rota do
catálogo convertia a **saída** de schemas Zod com transformações para JSON
Schema e respondia 500 na configuração do agente; a barra de ações em lote
ficava fora da viewport do funil. A rota agora serializa a entrada das tools,
e um teste percorre todos os schemas publicados. A barra fica ancorada à
viewport com espaço para o conteúdo e para a área segura do celular. Na
execução seguinte, as partes 1, 3, 4 e 5 do E2E passaram. A parte 2 expôs
duas fixtures antigas: o token de teste não incluía opt-in para ativação de
automação e arquivamento, e uma asserção assumia o tamanho anterior do pacote
de tools. A correção mantém as capabilities explícitas e calcula as vagas
pela tela. A nova execução ainda precisa passar integralmente.

Essa execução revelou um problema do serviço de follow-up: o envio inline
consultava cinco jobs pendentes e só depois filtrava o contato pedido. Cinco
jobs de outros contatos podiam ocultar o job correto. A consulta agora aplica
o filtro de contato **antes** do limite; o teste unitário reproduz a fila com
cinco jobs alheios. A mesma rodada mostrou que a expectativa E2E de não haver
nenhuma capacidade crítica em "Atender" estava vencida: apagar nota interna é
crítica e exige seleção individual. O teste passa a exigir que nenhuma crítica
seja ligada pelo pacote e que o envio ao cliente continue indisponível ali.
Nova rodada completa é obrigatória antes de fechar o audit.

Na rodada seguinte, o E2E encontrou outra divergência da mesma fronteira:
`crm_send_whatsapp_message` tinha `marcavel: false` no catálogo e o motivo
aparecia na lista avançada, mas o checkbox dessa lista ignorava `marcavel`.
A ficha do pacote já respeitava a regra. A lista avançada agora aplica a mesma
condição; o E2E existente exige que o checkbox permaneça desabilitado.
Typecheck e lint locais passaram. O E2E dessa correção confirmou a fronteira,
mas encontrou um defeito diferente na visão Mês da agenda: a grade desenha seis
semanas, incluindo dias dos meses vizinhos, enquanto o cliente só consultava do
dia 1 ao último dia do mês. Um evento externo visível numa célula de setembro
sumia quando a âncora mudava para outubro. O recorte da consulta agora cobre as
mesmas 42 células que a grade desenha. O E2E precisa confirmar a correção antes
de declarar gaps A iguais a zero.

## Migrations, baseline e updater

A 1.46 acrescenta `20260923160000_0392_demanda_derivada_nao_reduplica.sql`
e corrige a reaplicação do baseline para não recriar demanda, índices ou coluna
temporária já concluídos. A linha MCP mantém a renumeração `0398` com timestamp novo para a
migration oficial de memória que colidiu com `0385` implantada. O instalador e
o updater aplicam o baseline acumulado da tag integrada; não exigem publicar
1.43, 1.44 e 1.45 separadamente. O harness `test-update-com-dados.sh` instalou
o baseline da tag `v1.42.0-mcp`, semeou dados e aplicou o baseline 1.46 com
`ON_ERROR_STOP=1` em PostgreSQL 15 e 17: dados e identidades dos objetos
inspecionados sobreviveram. O workflow de publicação repete esse salto da
última tag MCP pronta. O CI da PR também mede instalação e reaplicação do
baseline atual nas duas majors. Uma ambiguidade ainda bloqueia a release.

## Gates de fechamento

Exigir CI `verify`, `invariants`, `imagens-ok` e `e2e` verdes na PR; typecheck,
lint, registry/policy/scopes/capabilities, autorização, cross-tenant, secrets,
rate limit, erros/request IDs, fluxos sentinela, baseline install/reapply,
shell/updater e build das quatro imagens no workflow de publicação. Só então
registrar SHA oficial e `gaps_a=0` em `RELEASE-AUDIT.json`, integrar a PR em
`mcp/stable`, publicar os quatro digests e, por último, o manifesto. A VPS só
atualiza por clique humano no painel.
