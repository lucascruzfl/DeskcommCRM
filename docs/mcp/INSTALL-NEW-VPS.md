# Reinstalação do DeskcommCRM + MCP em uma VPS nova

Este runbook reconstrói uma instalação a partir do Git e dos segredos do próprio operador. Ele não
contém secrets e não substitui `hostgator-setup-kit/install.sh`, que é a fonte de verdade. Execute
os passos na VPS nova; não teste contra produção durante uma preparação.

## 1. Provisione a VPS

Use Linux x86_64/amd64, 2 vCPU, 4 GB de RAM e pelo menos 80 GB. Ubuntu 22.04/24.04 é o caminho
testado. Confirme a porta SSH antes de configurar firewall; libere essa porta, 80 e 443 também no
painel da hospedagem. Uma VPS com proxy próprio (Hostinger, Coolify, Dokploy, CloudPanel) deve
manter esse proxy ligado.

## 2. Confira requisitos

```bash
uname -m
nproc
free -m
df -h /
docker --version
docker compose version
ss -tlnp | grep sshd
```

O instalador oferece instalar Docker quando necessário. Com pouca memória disponível, configure
swap controlada antes de qualquer build excepcional. O caminho normal usa imagens publicadas e não
compila na VPS.

## 3. Clone o fork recuperável

Clone o fork que publicou uma release MCP validada. Não copie `.env` pelo Git:

```bash
git clone --branch v1.42.0-mcp --depth 1 https://github.com/lucascruzfl/DeskcommCRM.git deskcommcrm
cd deskcommcrm
```

Use a tag MCP já publicada (troque `v1.42.0-mcp` pela atual). Assim o próprio
instalador e seu validador de manifesto existem desde o primeiro comando,
mesmo quando a branch padrão do fork ainda não recebeu essa release.

## 4. Selecione a versão MCP

O instalador do canal MCP seleciona a maior tag validada, confere o manifesto
e usa os digests das quatro imagens. Configure o canal no ambiente antes da
primeira instalação; não selecione a branch MCP diretamente para produção:

```bash
export DESKCOMM_UPDATE_CHANNEL=custom-mcp
export DESKCOMM_UPDATE_REPOSITORY=lucascruzfl/DeskcommCRM
export DESKCOMM_IMAGE_REPOSITORY=ghcr.io/lucascruzfl/deskcommcrm
```

O instalador grava as três chaves no `.env` local. Sem release e manifesto
publicados, ele recusa antes de instalar uma imagem oficial. Veja
[MCP-UPDATE-CHANNEL.md](MCP-UPDATE-CHANNEL.md).

## 5. Reponha ambiente e segredos próprios

Tenha em mãos domínio, credenciais Supabase, provedor de IA opcional e conta inicial. Prefira o
token pessoal temporário do Supabase para o instalador descobrir o Session pooler e configurar URLs
de e-mail; ele não é persistido. Sem token, use a connection string **Session pooler**, não Direct
IPv6. Nunca cole secrets em issue, commit, log ou neste runbook.

## 6. Instale e suba

```bash
bash hostgator-setup-kit/install.sh
```

Use o modo interativo. Ele valida entradas, retoma após interrupção, cria `.env` local e sobe os
serviços. Não apague `.env`, volumes ou sessões para recomeçar; reexecute o instalador. Em VPS com
proxy próprio, o kit detecta o modo e mantém o override de Traefik.

## 7. Aplique e valide migrations

O instalador e o `update.sh` aplicam `supabase/baseline.sql`, inclusive o apêndice idempotente. Não
aplique SQL avulso. Confira que o commit selecionado contém a tripla MCP descrita no manifest:

```bash
test -f supabase/migrations/20260921092259_0382_replace_faq_atomico.sql
grep -n '0382_replace_faq_atomico' supabase/migrations/MANIFEST.md
```

O arquivo apenas prova que a migration está versionada; a validação do banco é o instalador terminar
sem erro e o healthcheck responder. A migration MCP `0382` já implantada não foi
renomeada. A migration oficial de link salvo recebeu o identificador `0385` no
fork para evitar colisão com a `0382` MCP e a `0383` posterior do upstream; seu
SQL foi preservado. O baseline integrado contém as duas mudanças.

## 8. Valide os serviços e a rota pública

```bash
bash hostgator-setup-kit/healthcheck.sh
curl -s -o /dev/null -w "%{http_code}\n" https://<DOMINIO>/
```

O domínio deve redirecionar para login (normalmente 307). `healthy` interno com 404 público indica
labels de proxy ausentes; siga `docs/runbooks/deploy.md` e não desligue o proxy da hospedagem.

## 9. Build/deploy conforme a doutrina

O caminho normal é imagem publicada pelo CI: commit → push → PR → merge → CI → pull/update. Não
construa na VPS. Se um build de validação for inevitável antes do deploy, use ambiente adequado; a
Parte 8 terminou com exit 137 no Turbopack por memória insuficiente e sem swap, não com erro de
código demonstrado. Repita esse build antes do deploy em runner adequado ou com swap temporária
controlada.

## 10. Crie o token MCP

Entre no CRM como administrador e abra **Configurações › Tokens de API**. Crie um token novo e
copie o plaintext uma única vez para um gerenciador de segredos. Nunca grave o bearer no fork ou na
VPS junto ao código.

## 11. Selecione o preset operacional

Na mesma tela, escolha explicitamente **Operação completa via MCP**. O preset usa papel manager e
concede scopes, allowlist e capabilities do catálogo atual sem transformar o token em admin. Revise
o que será concedido antes de salvar.

## 12. Instale a Skill

Em cada computador que rodará o cliente, use o repositório publicado da Skill e o proprietário real:

```bash
npx github:<PROPRIETARIO_REAL>/deskcomm-mcp-skill codex
npx github:<PROPRIETARIO_REAL>/deskcomm-mcp-skill claude
```

Informe a base `https://<DOMINIO>` e o token no prompt sem eco. Use `--global` somente quando a
integração deve valer para todos os projetos daquele usuário.

## 13. Verifique `tools/list`

```bash
npx github:<PROPRIETARIO_REAL>/deskcomm-mcp-skill verify-connection
npx github:<PROPRIETARIO_REAL>/deskcomm-mcp-skill doctor codex
```

O aceite é handshake válido, `tools/list` não vazio e metadata válida. A contagem exibida é um
snapshot informativo; não exija um total fixo.

## 14. Smoke test

Peça ao cliente MCP uma operação somente de leitura: atualizar o catálogo, descobrir pipelines e
consultar um item descoberto. Confirme que nenhum ID foi inventado. Depois faça uma operação segura
com validação/preflight e reconsulta, sem envio real. Ações que retornarem
`human_action_required`/`human_confirmation_required` devem parar na pessoa.

## 15. Faça o backup inicial

```bash
bash hostgator-setup-kit/backup.sh
```

Copie o backup criptografado/adequadamente protegido para armazenamento fora da VPS e registre a
data. Siga [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md) para preservar banco, storage, WAHA/sessões,
segredos e validar restauração.
