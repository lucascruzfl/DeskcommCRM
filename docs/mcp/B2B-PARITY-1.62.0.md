# Paridade MCP do CRM B2B introduzido na v1.62.0

Estado: correção local da família B2B, **sem veredito de compatibilidade da release**. Base `mcp/stable` em `fc4d663c795ebf994516d02274179120deb0b953`. A matriz compara as rotas novas de `v1.57.0..v1.62.0`, os handlers de `lib/crm-b2b` e o registry MCP. A classificação A considera operações canônicas, org-scoped e delegáveis; B requer pessoa, binário ou serviço externo. Não há operação C nesta família.

**Os três gaps adicionais foram implementados localmente nesta sessão:** `crm_get_tags_report`, `crm_create_honorarios_contrato` e `crm_create_honorarios_parcela`, com serviços compartilhados com HTTP. A revisão diferencial encontrou um domínio grande novo com gaps A em listagem/detalhe/edição de propostas e parou antes de ampliar o escopo. A matriz e os limites da prova estão em `PARITY-1.62.0-REVIEW.md`. Este documento não afirma paridade completa nem autoriza a release.

| Superfície canônica | Classe | Decisão MCP |
| --- | --- | --- |
| `GET /companies`, `GET /companies/:id` | A | `crm_list_companies`, `crm_get_company` via handlers compartilhados. |
| `POST /companies`, `PATCH /companies/:id` | A para cadastro, B para enriquecimento | `crm_create_company`, `crm_update_company` chamam handlers canônicos com `enrich: false` explícito, inclusive quando o argumento chega sem o campo. Não aceitam `enrich` no schema público. |
| `POST /companies/:id/enrich` e `enrich=true` nas escritas HTTP | B | Consulta BrasilAPI e altera o cadastro com resposta externa; permanece na rota humana. Nenhuma tool de enriquecimento. |
| `GET /people`, `GET /people/:id` | A | `crm_list_people`, `crm_get_person` via handlers compartilhados. |
| `POST /people`, `PATCH /people/:id` | A | `crm_create_person`, `crm_update_person`; criação MCP separa o vínculo opcional para uma decisão explícita. |
| `POST /company-people`, `PATCH /company-people/:id` | A | `crm_link_company_person`, `crm_update_company_person`; trigger `fn_company_people_same_org` barra IDs de outro tenant mesmo com service role; vínculo repetido recebe conflito. |
| `PATCH /contacts/:id/person` | A | `crm_link_contact_person` associa ou limpa o vínculo pelo handler canônico; trigger de `contacts.person_id` exige mesma organização. |
| `GET /imports`, `GET /imports/:id` | A | `crm_list_import_batches`, `crm_get_import_batch` usam handlers de leitura extraídos e compartilhados com as rotas. As queries filtram `organization_id` e o detalhe limita 500 linhas como a rota. |
| `POST /imports` CSV/XLSX | B | Continua humano: transporta `File`/binário, mapeia colunas e pode solicitar enriquecimento. Nenhuma tool de upload/importação. |

Todas as 13 tools têm `modulo: "crm_b2b"` no catálogo. O MCP externo e o runtime omitem o módulo desligado; cada handler MCP reconsulta `moduloLigado` antes de executar, para que uma chamada direta não ultrapasse a chave. O módulo é da **instalação**, não um campo controlado pelo token. As queries de domínio recebem exclusivamente `ctx.organizationId`; nenhum schema público aceita `organization_id`. O MCP usa service role, portanto o filtro de organização nos handlers é obrigatório além dos triggers de integridade.

O domínio granular escolhido é `contacts`, que já governa a identidade de quem se relaciona com o CRM e existe nos tokens completos emitidos antes desta mudança. Não há fallback para `ai`. O `managedAreaOfTool` usa áreas exatas: Empresas → `/app/companies`, Pessoas e vínculos → `/app/people`, lotes → `/app/imports`. Detalhes e vínculos que agregam entidades exigem também as outras áreas tocadas, impedindo que um override de Empresas revele Pessoas ou Contatos. Os presets managed de clínica e ISP marcam essas três áreas `not_applicable`, então nem manager desses tenants obtém as tools por policy. O preset completo anterior é reconhecido somente se contém **todos** os domínios, capabilities e IDs de tools já existentes; assim os 13 IDs novos continuam disponíveis para esse token. Uma allowlist parcial não recebe acesso implícito. Tokens novos usam o catálogo atualizado.

Criação de empresa/pessoa grava `created_by` com `provisionedByUserId` do token, que é FK de `auth.users`; sem essa proveniência a escrita falha. O ID do token ou de um run de IA nunca entra nessa FK. A auditoria do handler atribui a ação ao token, enquanto a auditoria universal registra a chamada MCP. `redigirParaAuditoria` grava apenas presença de ID/busca, nomes de campos e limites, sem valor de CNPJ, nome, email, telefone, endereço, notas, cargo, departamento ou termo de busca. `redigirErroParaAuditoria` substitui mensagens de erro das 13 tools antes de gravar o metadata, inclusive nos ingressos HTTP e runtime de IA.

## Living System Checklist

Entrada: token MCP autorizado e módulo ligado, ou UI já existente. Saída: os mesmos handlers servem MCP e rotas; os dados aparecem em `/app/companies`, `/app/people` e `/app/imports`. Registro: mutações usam a auditoria dos handlers e todas as chamadas MCP usam `mcp.tool_called`; os logs não guardam PII dos argumentos. Porta e configuração: catálogo MCP, scopes `contacts`, áreas managed exatas e `/admin/sistema` para a chave `crm_b2b`. Continuidade: um operador revisa os cadastros e lotes pelas telas; upload e enriquecimento externo continuam humanos. As leituras não criam demanda. Falha de vínculo, CNPJ duplicado ou módulo desligado devolve erro; o operador corrige os dados ou o módulo e repete explicitamente. O mapa `docs/architecture/crm-b2b-companies-people.architecture.json` liga MCP, handlers, banco e telas.


## Catálogo de atendimento e importações

As 13 tools B2B permanecem no MCP externo, com os mesmos papéis/scopes.
As consultas de lotes de importação ficam marcadas apenasHumano no catálogo:
são histórico operacional de uploads humanos, e não capacidades de atendimento
da IA interna. As quatro leituras de empresas/pessoas continuam selecionáveis.
O pacote organizar tem 26 capacidades, respeitando o teto existente de 27,
sem ampliar onboarding, teto ou permissões. A/B da cerca de seleção: base 22,
candidato anterior 28; duas consultas operacionais fora do pacote resolvem o caso.
