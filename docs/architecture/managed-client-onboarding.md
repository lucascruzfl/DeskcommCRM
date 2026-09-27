# Living System Checklist — onboarding de cliente gerenciado

- **Entrada:** `crm_preflight_managed_client` e `crm_create_managed_client` recebem o pedido no MCP. `managedOnboardingService.preflight` revalida o ator no banco antes da criação.
- **Saída:** `fn_begin_managed_client_onboarding` chama `fn_create_tenant_with_owner`; o tenant aparece em `user_organizations` e no organization switcher. O convite oficial cria o caminho de aceite para a pessoa da clínica.
- **Atividade:** `managed_client.onboarding_started`, `managed_client.onboarding_completed` e `managed_client.onboarding_failed` entram em `api_audit_log` e são visíveis em `/app/audit`. `managed_client_onboardings` guarda estado, horário e erro sanitizado para retomada.
- **Tela e porta:** o gestor entra no tenant pelo organization switcher e consulta a trilha em `/app/audit`, já presente em `lib/navigation/catalogo.ts`. Não há nova tela nesta fase.
- **Anti-morte:** recibo único por ator e chave, claim exclusivo de envio e estados `organization_created`, `inviting`, `failed` e `completed`. Uma falha de envio deixa o mesmo tenant e convite lógico disponíveis para retry.
- **Configuração:** e-mail de saída vem da configuração SMTP/Resend existente; preflight mostra `email_delivery_not_configured` e mantém `can_execute=false` quando não há transporte. O preset e as áreas vêm de `lib/managed-clients/presets.ts`.
- **Continuidade IA↔humano:** o MCP mostra o plano e exige `confirm=true` da pessoa antes do efeito. A pessoa convidada conclui autenticação pelo aceite normal. Não há turno de agente ou handoff de conversa neste fluxo.
- **Laço de retorno:** falha de envio muda o recibo para `failed`, registra a ação de auditoria e devolve `retryable=true`; a repetição consulta o recibo e retoma sem criar outra organização. Resultado concluído devolve `already_completed` com o mesmo ID.
- **Mapa vivo:** `managed-client-onboarding.architecture.json` liga entrada, serviço, RPC, recibo, convite, memberships, pessoas e auditoria.
