# Backup e recuperação do DeskcommCRM + MCP

Backup válido é o conjunto que pode ser restaurado e verificado, não apenas um arquivo criado sem
erro. Não use comandos destrutivos para “testar” numa instalação viva.

## O que preservar

- **Banco Supabase/Postgres:** schema, dados tenant-aware, Auth e metadados necessários. O baseline
  reconstrói schema fresco; o dump preserva dados da operação.
- **Storage privado:** especialmente `whatsapp-media` e arquivos de knowledge/exports permitidos.
- **WAHA e sessões:** volumes/configuração de sessão conforme a topologia do compose. Nunca use
  `docker compose down -v`, pois remove sessão/certificados.
- **Ambiente e secrets:** `.env`, credenciais de provedores, chaves de assinatura e tokens fora do
  Git, em cofre/backup criptografado com acesso restrito.
- **Código/fork:** remote, tags, branch MCP, commits próprios e manifest de release.
- **Skill:** repositório publicado/commit da Skill. URL/token não pertencem ao pacote; ficam no
  armazenamento protegido do usuário e devem ser recuperáveis pelo cofre.
- **Configuração de domínio/proxy:** DNS, modo de proxy e nomes necessários para reconstrução.

## Criar e retirar o backup

```bash
bash hostgator-setup-kit/backup.sh
```

O script guarda arquivos na mesma VPS; copie-os para armazenamento externo protegido e registre
checksum, data, versão do CRM e escopo. Um disco da mesma VPS não é recuperação de desastre.

## Restaurar sem destruir a origem

1. Provisione uma VPS/banco descartável compatível.
2. Clone a tag/commit registrado no manifest.
3. Reponha secrets pelo cofre, nunca pelo Git ou chat.
4. Use os scripts oficiais de restore do kit quando o tipo de backup corresponder; não improvise
   SQL parcial nem apague volumes da origem.
5. Reponha storage e sessões conforme a topologia documentada.
6. Execute `healthcheck.sh`, valide login, organização, contagens agregadas e acesso a mídia.
7. Gere um token MCP novo para o ambiente restaurado; não reutilize plaintext sem necessidade.
8. Rode handshake, `tools/list` e smoke test DISCOVER → INSPECT → VALIDATE → EXECUTE seguro →
   VERIFY.
9. Só promova o ambiente restaurado depois de confirmar DNS/proxy, e-mail, worker, scheduler,
   WAHA, Redis, auditoria e isolamento entre tenants.

Registre o que não foi medido. Restore nunca deve apontar silenciosamente para banco ou storage de
produção durante um ensaio.
