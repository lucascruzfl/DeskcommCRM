# Atualizar o DeskcommCRM sem reconstruir o MCP

O MCP faz parte do mesmo produto e evolui incrementalmente. A Skill descobre o catálogo atual por
`tools/list`; atualização não significa reescrever um servidor paralelo.

## Fluxo obrigatório

```text
upstream oficial
→ fetch
→ medir delta
→ merge seguro
→ auditoria delta
→ compatibilidade MCP
→ testes sentinela
→ migrations
→ build
→ backup
→ deploy
→ smoke test
```

1. Em árvore limpa, rode `git fetch origin` e meça merge-base, atraso, commits próprios e
   sobreposição. Não use reset, rebase publicado ou force push.
2. Faça um merge seguro da `origin/main` para a branch MCP somente quando necessário. Resolva
   conflito lendo os dois lados, especialmente baseline/MANIFEST.
3. Siga [AUDIT-NEW-VERSION.md](AUDIT-NEW-VERSION.md): compare UI, API/actions, serviços, workers,
   schema e registry; classifique operações A/B/C.
4. Atualize apenas adapters/tools afetados. Preserve `/api/mcp`, bearer `dsk_...`, organização do
   contexto, autorização e ação humana estruturada.
5. Rode sentinelas e regressão:

   ```bash
   pnpm exec vitest run tests/unit/mcp-compatibility-sentinels.test.ts tests/unit/mcp-final-flows.test.ts
   pnpm test:unit
   pnpm test:db
   pnpm typecheck
   pnpm lint
   pnpm lint:channels
   pnpm lint:role-rank
   pnpm release:conferir
   git diff --check
   ```

6. Se houver schema, entregue migration + apêndice idempotente no baseline + MANIFEST e valide
   instalação/reaplicação. Nunca edite migration aplicada.
7. Rode `pnpm build` em ambiente com memória adequada. Exit 137/Turbopack por falta de memória é
   falha ambiental a repetir, não autorização para refatorar código sem diagnóstico.
8. Antes de deploy, execute `bash hostgator-setup-kit/backup.sh` e retire uma cópia da VPS.
9. O deploy normal usa `bash hostgator-setup-kit/update.sh`, que puxa imagens publicadas, reaplica
   baseline e preserva a topologia. Em proxy próprio, todo `up -d` manual leva os dois compose
   files descritos em `docs/runbooks/deploy.md`.
10. Depois do deploy, valide healthcheck, 307 no domínio, handshake MCP, `tools/list` e um fluxo de
    leitura/validação/mutação segura/verificação.

Atualize o manifest de release com commit base, commit testado, migrations e testes. A contagem de
tools é snapshot; divergência exige auditoria, não comparação rígida.
