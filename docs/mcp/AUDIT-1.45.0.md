# Auditoria diferencial 1.42.0-mcp → upstream v1.45.0

Estado em 2026-09-23: **bloqueada**. Fonte: release oficial `v1.45.0`, commit
`4778e7e9c7b0f91bdec7bb9b8a5c475aaccee2e0`. Base MCP publicada:
`v1.42.0-mcp` (`381fb71c3fe8eb25d81f1ab15e2050b01b9437c5`). A comparação
`v1.42.0..v1.45.0` altera 263 arquivos; não se usou a `main` como versão.

## Integração

Merge único `git merge --no-commit --no-ff v1.45.0` sobre a linha MCP encontrou:

- `lib/mcp/tools/messages.ts` e seu teste: upstream introduziu ritmo de envio por token, enquanto o MCP Full Control já tinha idempotência e envio de mídia próprios.
- `lib/mcp/tools/start-conversation.ts` e seu teste: mesmo conflito para abertura e envio.
- `package.json`: as duas linhas acrescentaram testes diferentes em `test:shell`.

Nenhum `ours/theirs` foi escolhido. A integração requer conciliar as duas garantias em cada fluxo e rodar os testes reais. **Sem tag, imagens ou manifesto 1.45.0-mcp.**

## Delta de produto a classificar

| Área | Mudança oficial | Classe provisória | Decisão pendente |
| --- | --- | --- | --- |
| Envio MCP/API | ritmo anti-ban, teto diário e Retry-After | A | preservar idempotência do fork e aplicar o ritmo no caminho MCP inteiro |
| Follow-up | duplicar/renomear fluxo, retorno e gatilho por lead | A candidata | mapear operações canônicas ao registry e ao preset manager |
| Skills de IA | versões e restauração | A/B | conferir autoridade, efeitos e serviço canônico |
| Produtos | fotos privadas e envio pelo agente | A/B | leitura segura versus upload binário e ação humana |
| Canais Datafy/Graph | modelos e credenciais | B/C | não expor segredo nem ativação sem consentimento |
| LGPD | anonimização de conversas e mídia | B | operação destrutiva permanece sob confirmação humana |
| Registro e OAuth | aprovações e recuperação | C | identidade/plataforma fora da autoridade MCP |
| UI e responsividade | painel de atualização e telas operacionais | A/B | validar regressão visual após integração |
| Updater/Docker | guardas de backup e shell tests novos | A operacional | manter fail-closed e rodar harness |

Esta tabela é triagem, **não** certificação de cobertura. Gaps A da 1.45.0:
**indeterminados** até a auditoria por operação. `RELEASE-AUDIT.json` continua em
1.42.0 e impede a publicação de uma tag 1.45.0-mcp.

## Migrations e salto de versão

A tag 1.45.0 inclui as migrations oficiais `0383`, `0385`, `0386`, `0387`,
`0390`, `0391` (timestamps e nomes completos em `supabase/migrations/`). A
linha MCP preserva a `0382` própria e a renumeração anterior registrada em
`INSTALL-NEW-VPS.md`. O instalador e atualizador reaplicam o **baseline
acumulado**, não percorrem tags/release por release. Portanto não há exigência
estrutural de publicar 1.43 e 1.44 separadamente. A prova operacional do salto
1.42 → 1.45 depende de merge completo, teste de instalação e reaplicação do
baseline, invariantes de banco e updater harness. Até esses gates passarem, o
salto continua bloqueado.

## Gates ainda pendentes

Resolução revisada dos cinco conflitos; classificação A/B/C por operação;
`gaps_a=0` demonstrado; sentinelas MCP; typecheck; lint; banco descartável;
baseline install/reapply; shell/updater; build das quatro imagens; digests
públicos; manifesto validado e publicado por último.
