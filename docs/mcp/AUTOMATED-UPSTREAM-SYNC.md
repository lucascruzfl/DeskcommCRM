# Releases oficiais → canal MCP

```text
UPSTREAM publica tag/release
→ AUTO DETECT (schedule ou execução manual no fork)
→ branch de integração isolada sobre mcp/stable
→ delta audit e PR; conflitos viram issue e bloqueiam
→ revisão A/B/C + gates MCP
→ release vX.Y.Z-mcp com quatro imagens e manifesto por último
→ PAINEL detecta release pronta
→ CLIQUE HUMANO em Atualizar
→ VPS atualiza por digest
```

`main` do fork pode receber **Sync fork** para acompanhar o upstream visualmente.
Esse clique não muda a produção nem publica MCP. O pipeline busca diretamente a
tag da release oficial; Sync fork manual não é requisito. O workflow oficial
`release.yml` foi desativado **apenas no fork** via GitHub Actions (estado
`disabled_manually`), porque é herdado do upstream e requer o GitHub App de
corte de release oficial. Assim, push e Sync fork não executam esse workflow.
Não reative sem revisar a identidade do repositório e as credenciais.

## Por que o Sync fork gerou o e-mail de falha

O [run 35930513488](https://github.com/lucascruzfl/DeskcommCRM/actions/runs/35930513488)
foi um `push` na `main` do fork, no commit
`d9846883a99ba53a0dabee709793c2f068737ac8`. Esse commit existe no
upstream oficial e é ancestral da `main` do fork: o Sync fork integrou código.
O arquivo herdado `.github/workflows/release.yml` reage a todo push na `main`,
sem condição de identidade do repositório. O job `cortar-tag` tentou criar o
token do GitHub App no passo `actions/create-github-app-token@v3` e parou com
`The 'client-id' (or deprecated 'app-id') input must be set to a non-empty string`:
o fork não tem o secret `RELEASE_APP_ID` do upstream. O job
`abrir-pr-de-release` foi pulado porque só roda em `workflow_dispatch`.
Nenhuma tag oficial foi cortada por esse run. A desativação manual de **apenas**
esse workflow no fork mantém CI, detector e publicação MCP disponíveis e evita
divergir a `main` do upstream só para alterar a condição do release oficial.

O detector gera `mcp-delta-report.md` como artefato. Um merge limpo abre PR para
`mcp/stable`; conflito abre issue com arquivos e interrompe a tentativa. A
execução seguinte reconhece a branch/PR existente e não duplica a solicitação.
O detector cria a PR com `GITHUB_TOKEN`, sem segredo pessoal. Pela
[regra do GitHub para PRs criadas por Actions](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs),
os checks dessa PR podem ficar em `action_required`. Nesse caso, abra a PR no
fork e clique **Approve workflows to run**; somente um mantenedor com acesso de
escrita pode fazê-lo. Até o CI passar, a proteção de `mcp/stable` bloqueia o
merge e a publicação. Usar `workflow_dispatch` para contornar esse clique não
serviria: [esses checks não satisfazem a proteção de PR](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated).
Se a tag oficial já estiver integrada em `mcp/stable`, o detector informa que a
auditoria ou os gates ainda bloqueiam a release, sem abrir outra PR.
A lista do delta distingue endpoints criados/alterados, contratos, policy,
workers, migrations e updater por caminho; a interpretação permanece na PR.
A configuração do fork permite que GitHub Actions crie PRs, mantendo a permissão
padrão do `GITHUB_TOKEN` em `read`; somente o workflow detector recebe
`contents`, `pull-requests` e `issues` como `write`. A classificação A/B/C exige
revisão humana quando a semântica mudou. Ao integrar o PR revisado em `mcp/stable`, o workflow dessa branch confere
a versão/a SHA oficiais, executa os gates, publica as quatro imagens, valida os
digests, cria a tag e anexa o manifesto a uma release em rascunho. Só então a
release fica pública. A release MCP continua fechada enquanto `RELEASE-AUDIT.json` não identificar a versão e
`gaps_a=0` com compatibilidade confirmada. O workflow de publicação repete os
gates e só publica `mcp-release.json` depois das quatro imagens e digests.

A branch `mcp/stable` está protegida no fork: exige PR atualizado e checks
`verify`, `invariants`, `imagens-ok` e `e2e` verdes; administradores também
seguem a regra, e force push e exclusão estão bloqueados. O workflow de
publicação repete typecheck, lint, testes unitários, instalação/reaplicação do
baseline, invariantes de banco, shell/updater e build antes de publicar.

Uma release oficial sem `-mcp`, teste falho, conflito, imagem ou manifesto
inválido não aparece no canal. A VPS nunca usa imagem oficial como fallback.
A produção só muda depois do clique humano no painel.

## Provas do comportamento fail-closed

- A/B: `tests/unit/mcp_upstream_test.py` cobre versão igual (noop), versão nova
  (integração elegível) e ignora release sem manifesto ou em rascunho.
- C: o mesmo harness simula conflito, exige issue e proíbe push/PR. A execução
  real para 1.46 abriu a [issue #4](https://github.com/lucascruzfl/DeskcommCRM/issues/4).
- D: `tests/unit/gatilho-dos-jobs-de-entrega.test.ts` exige que o job de
  publicação dependa de `validate`, que contém testes e banco. Um `verify`
  vermelho impede merge em `mcp/stable` pela proteção da branch.
- E/F: `tests/unit/mcp_manifest_test.py` exige os quatro metadados e digests
  válidos antes de construir o manifesto completo; o workflow confere acesso
  anônimo aos quatro digests e publica a release por último.
- G: `tests/shell/mcp-update-channel.test.sh` prova que uma versão oficial sem
  manifesto MCP não é oferecida como fallback à VPS.

Situação atual 1.47.0: [AUDIT-1.47.0.md](AUDIT-1.47.0.md) registra a detecção
real, os conflitos e a candidata de integração. As candidatas 1.45 e 1.46
foram incorporadas à 1.47 antes de qualquer publicação MCP. Nenhuma delas
é release MCP pronta.
