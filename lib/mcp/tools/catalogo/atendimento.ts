/**
 * Capacidades de ATENDIMENTO — cliente, conversa, mensagem.
 *
 * ESTE ARQUIVO FALA COM O HUMANO que configura o agente — `rotulo`,
 * `explicacao` e `oQueToca`. O texto que vai ao MODELO é a `description` do
 * HANDLER (`lib/mcp/tools/<dominio>.ts`), e ela NÃO tem cópia aqui: até
 * 2026-08-07 tinha, ninguém lia essa cópia, e 48 das 51 divergiam do que o
 * modelo realmente recebia. O campo foi removido em vez de sincronizado —
 * duplicata que ninguém lê não é documentação, é armadilha: um script de
 * medição de vazamento chegou a montar o prompt com o texto errado, sob um
 * comentário dizendo "a ferramenta como o modelo a vê".
 * Ver `docs/handoffs/BRIEFING-ia-360.md` §4.
 */
import { declararTools } from "./tipos";

export const TOOLS_ATENDIMENTO = declararTools([
  {
    name: "crm_search_contacts",
    category: "read",
    rotulo: "Procurar cliente",
    explicacao:
      "Encontra um cliente pelo nome, telefone ou e-mail, para o agente saber com quem está falando antes de responder.",
    oQueToca: "Cadastro de clientes",
    risco: "seguro",
    pacotes: ["atender", "vender"],
  },
  {
    name: "crm_get_contact",
    category: "read",
    rotulo: "Ver ficha do cliente",
    explicacao:
      "Abre a ficha completa de um cliente: dados de contato, histórico e por onde ele chegou até a empresa.",
    oQueToca: "Cadastro de clientes",
    risco: "seguro",
    pacotes: ["atender", "vender"],
  },
  {
    name: "crm_propose_contact_field",
    category: "write",
    // SEM `description` aqui, e não por esquecimento: o catálogo perdeu esse
    // campo no `02d9acea` (eram 51 cópias que ninguém lia). Quem serve a
    // descrição ao cliente MCP é `catalogo-servido.ts:58`, e ele lê
    // `handler.description` — a de `lib/mcp/tools/contacts.ts:135`, que existe e
    // continua valendo. O catálogo responde outra pergunta: o que o HUMANO lê na
    // tela (`rotulo`, `explicacao`, `oQueToca`).
    //
    // Esta linha é o encontro de dois trabalhos que não se viram: a remoção do
    // campo veio pela branch do Índice de Atrito e a ferramenta veio pelo #194.
    // Nenhum dos dois gerou conflito de texto — o `tsc` é que reprovou no merge.
    rotulo: "Anotar dado que o cliente informou",
    explicacao:
      "Quando o cliente diz o e-mail, o nome ou o telefone dele na conversa, guarda essa informação para uma pessoa conferir antes de entrar na ficha.",
    oQueToca: "Cadastro de clientes",
    // `atencao`, não `critico`: nada sai para o cliente e nada entra na ficha
    // por conta dela — o peso mora na confirmação, que é humana. Marcar
    // `critico` aqui faria a tela pedir cerimônia para uma anotação.
    risco: "atencao",
    // ⚠️ FORA de "atender", e a razão é o TETO — não o valor da capacidade.
    //
    // O pacote "Atender" exige 18 vagas, quase o teto inteiro por agente.
    // Acrescentar esta capacidade ali empurraria para 19 um pacote que já é o
    // maior — e, somado ao que um agente costuma trazer ligado, é ele que
    // encosta no teto primeiro.
    //
    // ⚠️ A ARITMÉTICA DESTE PARÁGRAFO MUDOU e a decisão não. Ele dizia
    // "18 + 3 = 21 num teto de 20: ligá-lo já era impossível". O teto foi para
    // 25 quando o dono do produto ficou sem como ligar as capacidades de agenda,
    // então 21 hoje CABE — o argumento de impossibilidade venceu. O que sustenta
    // a escolha agora é folga, não bloqueio, e por isso a linha continua sendo
    // candidata a voltar numa revisão dos pacotes.
    //
    // Fica em "vender", que tem folga, e continua alcançável em qualquer jornada
    // pelo modo avançado. Quando o teto ou o tamanho do pacote for revisto, esta
    // linha é candidata natural a voltar.
    pacotes: ["vender"],
  },
  {
    name: "crm_list_conversations",
    category: "read",
    rotulo: "Listar conversas",
    explicacao:
      "Mostra as conversas em andamento, quem está cuidando de cada uma e a posição de cada cliente na fila de espera.",
    oQueToca: "Atendimento",
    risco: "seguro",
    pacotes: ["atender", "escalar"],
  },
  {
    name: "crm_get_conversation",
    category: "read",
    rotulo: "Ver uma conversa",
    explicacao:
      "Abre os detalhes de uma conversa: quem está atendendo, marcadores aplicados e há quanto tempo o cliente espera.",
    oQueToca: "Atendimento",
    risco: "seguro",
    pacotes: ["atender", "escalar"],
  },
  {
    name: "crm_get_conversation_history",
    category: "read",
    rotulo: "Ler o histórico da conversa",
    explicacao:
      "Lê as mensagens já trocadas com o cliente, para o agente responder sem pedir que ele repita o que já contou.",
    oQueToca: "Atendimento",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_get_message",
    category: "read",
    rotulo: "Ver uma mensagem e sua entrega",
    explicacao:
      "Mostra uma mensagem específica, se chegou, foi lida ou falhou e qual mensagem ela estava respondendo, sem expor endereço privado de arquivo.",
    oQueToca: "Atendimento",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_list_internal_notes",
    category: "read",
    rotulo: "Ler anotações internas da conversa",
    explicacao:
      "Mostra as anotações que a equipe deixou dentro do atendimento e que nunca são enviadas para o cliente.",
    oQueToca: "Atendimento interno",
    risco: "seguro",
    pacotes: ["atender", "escalar"],
  },
  {
    name: "crm_list_handoff_history",
    category: "read",
    rotulo: "Ver as passagens entre automático e equipe",
    explicacao:
      "Mostra cada vez que o atendimento saiu do automático para uma pessoa ou voltou, com o contexto deixado para quem continuou.",
    oQueToca: "Continuidade do atendimento",
    risco: "seguro",
    pacotes: ["atender", "escalar"],
  },
  {
    name: "crm_list_messaging_channels",
    category: "read",
    rotulo: "Ver os números disponíveis para atender",
    explicacao:
      "Mostra quais conexões podem enviar mensagem agora e quais ainda precisam que uma pessoa conclua a conexão, sem revelar chaves.",
    oQueToca: "Conexões de atendimento",
    risco: "seguro",
    pacotes: ["atender", "organizar"],
  },
  {
    name: "crm_send_whatsapp_message",
    category: "write",
    rotulo: "Enviar mensagem no WhatsApp",
    explicacao:
      "Envia uma mensagem de WhatsApp para o cliente. Ele recebe de verdade, no celular dele, e não dá para desfazer.",
    oQueToca: "Atendimento",
    risco: "critico",
    pacotes: ["atender"],
  },
  {
    name: "crm_reply_message",
    category: "write",
    rotulo: "Responder uma mensagem específica",
    explicacao:
      "Envia uma resposta ligada à mensagem escolhida no histórico, para o cliente entender exatamente a que assunto a equipe respondeu.",
    oQueToca: "Atendimento",
    risco: "critico",
    pacotes: ["atender"],
  },
  {
    name: "crm_close_conversation",
    category: "write",
    rotulo: "Encerrar um atendimento",
    explicacao:
      "Fecha uma conversa pela regra oficial do atendimento e mantém no histórico o ponto exato em que aquele episódio terminou.",
    oQueToca: "Atendimento",
    risco: "atencao",
    pacotes: ["atender"],
  },
  {
    name: "crm_reopen_conversation",
    category: "write",
    rotulo: "Reabrir um atendimento",
    explicacao:
      "Abre um novo episódio de atendimento numa conversa encerrada, sem fingir que o encerramento anterior nunca aconteceu.",
    oQueToca: "Atendimento",
    risco: "atencao",
    pacotes: ["atender"],
  },
  {
    name: "crm_mark_conversation_read",
    category: "write",
    rotulo: "Marcar uma conversa como lida",
    explicacao:
      "Zera o aviso de mensagens novas para quem está cuidando da conversa, sem mandar confirmação de leitura para o celular do cliente.",
    oQueToca: "Atendimento",
    risco: "atencao",
    pacotes: ["atender"],
  },
  {
    name: "crm_create_internal_note",
    category: "write",
    rotulo: "Criar anotação interna no atendimento",
    explicacao:
      "Guarda uma observação para a equipe dentro da conversa; o texto não é enviado ao cliente e mantém registrado quem escreveu.",
    oQueToca: "Atendimento interno",
    risco: "atencao",
    pacotes: ["atender", "escalar"],
  },
  {
    name: "crm_delete_internal_note",
    category: "write",
    rotulo: "Apagar anotação interna",
    explicacao:
      "Apaga uma observação interna somente quando o token pertence ao autor ou a uma pessoa gestora; nada é enviado ao cliente.",
    oQueToca: "Atendimento interno",
    risco: "critico",
    pacotes: ["atender", "escalar"],
  },
  {
    name: "crm_start_conversation_and_send",
    category: "write",
    rotulo: "Iniciar conversa com cliente novo e enviar mensagem",
    explicacao:
      "Cria o cadastro do cliente se ele ainda não existir, abre uma conversa nova no número de " +
      "WhatsApp escolhido e manda a primeira mensagem para ele — de verdade, no celular dele.",
    oQueToca: "Atendimento",
    risco: "critico",
    // Nasce para automação externa (ex.: prospecção que acabou de captar um
    // cliente novo), não para o agente conversacional em turno — por isso
    // `apenasHumano` abaixo e o papel mínimo ficam acima do que o agente
    // publicado alcança (ver tests/unit/capacidade-alcancavel-pelo-agente.test.ts).
    pacotes: ["vender"],
    apenasHumano: true,
  },
]);
