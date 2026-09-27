# Manutenção pré-Fase 6 — base MCP 1.53

Estado inicial desta continuação: branch `feat/managed-aesthetic-clinic-onboarding`,
HEAD `081fbc9f8160450a696c1fda726734584a62225e`, oito arquivos modificados e
`leep 2` não rastreado. Patch inicial preservado em `/tmp/pre6-initial-worktree.patch`.
`leep 2` é captura ANSI de saída Git e não faz parte da entrega.

## Base já concluída

PR #16 mesclado em 2026-09-27 01:45:23 UTC, commit `6618064538ccfe4e3c61e311f274e9e73b94e1c5`.
CI `36285168518`, E2E `36285168538`, perf `36285168516` e imagens `36285168537`: success.
A branch intermediária `mcp/integrate/1.52.0` permanece em `460a54e995a917dd965653e8784ff6f5f4b9834b`.
Ela já recebeu a base 1.53; não houve novo merge nem publicação 1.52 nesta continuação.

A tag `v1.53.0-mcp` aponta para `d52ea52591174fbff0e338c0e14a5f45cb11b929`,
originada da branch `feat/mcp-update-1.53`, já mesclada pelo PR #14.
Commit de 2026-09-26 21:43:24 UTC; release publicada às 22:49:42 UTC.
Upstream oficial `v1.53.0` é tag anotada cujo commit é
`f5701b42bada06ee330701476bf1c28432cb2918`, ancestral da release MCP.
`mcp/stable` contém a tag e tem exatamente a mesma árvore. A correção da versão
(APP_VERSION principal e SHA secundário) já está na release publicada.
Manifest baixado novamente da release e validado pelo validador do kit.
Os quatro digests foram consultados anonimamente no GHCR, incluindo hash do
manifest OCI e labels de revisão/versão das configurações. Todos apontam para
a revisão da tag e `1.53.0-mcp`. Não há nova release necessária.

## Pendências concretas após reconciliar managed

Os runs `36286866466` e `36286866479`, no HEAD inicial, reprovaram.
Corrigidos apenas os pontos encontrados: tipos regenerados de baseline aplicado
em Postgres descartável; área nova `/app/ai/atendimento` reservada à agência;
resources novos classificados; mocks adaptados ao guard e transporte vigentes;
E2E usando o helper compartilhado da suíte.

As correções SQL pendentes foram preservadas como nova migration 0452,
apêndice idempotente e linha no MANIFEST. As migrations 0445 e 0450 voltaram
exatamente ao conteúdo histórico do HEAD: a lógica válida continua na 0452.
Ela recupera as transições de perda, motivo categorizado, identidade social e
cascata LGPD oficial, mantendo projeções e guardas managed. O baseline preserva
o OID de `comando_da_conversa` para aceitar reapply com a view operacional.

O catálogo RPC foi lido do banco final. Revisados somente os 24 registros novos
ou alterados pela base 1.53/forward-fix; funções novas sem EXECUTE para clientes
continuam sem ingresso direto, e funções alcançáveis mantêm tenancy e guardas.
O snapshot `managed-client-rpc-audit.json` mede corpos e privilégios reais.

## Evidências locais e gates remotos

- 154 testes direcionados: PASS, incluindo versão, runtime MCP e regressões encontradas.
- Instalação fresca e reapply do baseline: PASS com ON_ERROR_STOP=1 em Postgres 17.
- Upgrade desde baseline da v1.53.0-mcp com dados: PASS; dez linhas preservadas,
  oito identidades de objetos e a view migrada estáveis na reaplicação.
- Typecheck local: Node atingiu limite de heap; não equivale a erro de TypeScript.
  Gate final pertence ao CI com o orçamento de memória já configurado.
- O primeiro recheck remoto `36288072004` confirmou typecheck e lint e apontou
  duas cercas sobre a ordem do baseline: o novo apêndice precisava anteceder
  a varredura anon, e os dois GRANTs anon do dump reconcediam o que a 0452 revoga.
  Apêndice reposicionado e grants retirados, preservando o estado final seguro.
  Os resultados finais são os runs GitHub Actions do HEAD remoto.

## Living System Checklist — reconciliação de infraestrutura

1. Entrada: release MCP validada e áreas do catálogo oficial.
2. Saída: policy canônica, guard REST/MCP e projeções do PostgREST existentes.
3. Registro: auditoria existente dos efeitos e snapshot RPC com hash/privilégios.
4. Tela: navegação e URLs existentes; E2E managed verifica cliente e gestor.
5. Porta: `NAV_CATALOG` existente e mapa resource→área.
6. Anti-morte: sem peça nova; manutenção de autorização não agenda demanda.
7. Configuração: preset e policy persistida existentes, ausência de área recusa acesso.
8. Continuidade: transporte e dados operacionais existentes preservados; sem turno novo.
9. Retorno: guards recusam antes do efeito; invariantes/E2E bloqueiam regressões.
10. Mapa: sem peça arquitetural nova; vínculos existentes são os mesmos.

`can_execute=false`; nenhum onboarding service, tenant real ou convite real.
Produção intocada. Não iniciada Fase 6; nenhuma tag, imagem ou release sobrescrita.

## Segundo ajuste dos gates concretos

O E2E confirmou gestor, bloqueio de URLs e JWT/cross-tenant; o histórico operacional
retornou 500 por ausência de sent_on_behalf_of_user_id na view de mensagens.
A nova migration 0453 publica somente esse UUID de autoria, preservando metadata
higienizada e filtros da projeção. A definição anterior do baseline também tem
a coluna para preservar OID no reapply; nenhuma migration histórica foi editada.
Autoria delegada é imutável em INSERT/PATCH autenticado na projeção: o serviço
preserva a atribuição, e JWT de cliente/gestor recebe 403 ao tentar falsificá-la.
O catálogo RPC foi relido do banco e o hash do trigger atualizado.
A cadeia histórica aplica uma vez, como o runner Supabase; forward-fixes novos
são reaplicados, e o harness continua provando o baseline inteiro duas vezes.

Os unitários restantes eram mocks de etapas/consultas/devolução e uma contagem
de campo que confundia FK com Row/Insert/Update. Os seis arquivos corrigidos
passaram em 62 casos. O catálogo MCP revisa as três ferramentas oficiais novas:
rascunho e retomada permitidos na área operacional; previsão de pipeline mantém
o domínio administrativo. O invariante HTTP com token persistido prova a lista
e a recusa de cada tool fora dela, sem remover o gate.

A regressão dirigida do segundo ajuste passou em 71 casos de seis arquivos de
invariantes (mensagens, JWT/RLS/MCP persistido, cadeia managed, grants, automação
e agenda), com fresh install e reapply. Registro MCP atual: 237 tools, zero
nomes duplicados. O CI do commit final é a referência para a suíte completa.

E2E `36288952935`: quatro cenários PASS. As capturas managed também são
gravadas em `.superpowers/evidence/managed/` e publicadas pelo passo de prova
visual existente, inclusive em sucesso, para tornar o gate revisável.

O último lote unitário do recheck mostrou dois gates concretos: bloco de rate
limit duplicado pelo merge managed (removido o anterior à idempotência, mantendo
o limitador dentro da execução real como na stable) e mock de catálogo sem
`supports_tools` (alinhado ao contrato oficial). A release/stable não tinham
essa duplicação; a correção fica exclusivamente na branch managed.
