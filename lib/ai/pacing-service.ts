/** Serviço canônico de configuração de ritmo. HTTP e MCP usam os mesmos bounds,
 * janelas resultantes, defaults e persistência. Não envia nem reconecta o canal. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  knobsView,
  effectiveKnobs,
  windowIsValid,
  WARMUP_PULADO,
  type ChannelKnobsRow,
  type PacingKnobsUpdate,
} from "@/lib/ai/pacing-knobs";

export class PacingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details: { publicField?: string } = {},
  ) {
    super(message);
  }
}

export const KNOB_COLUMNS =
  // As duas janelas entram no SELECT: sem `resposta_*` aqui, a ficha Anti-ban
  // mostraria 7h-22h como se fosse a janela da resposta — e é a de DISPARO.
  "throttle_ms, jitter_max_ms, window_start_hour, window_end_hour, resposta_start_hour, resposta_end_hour, allow_sunday, timezone, warmup_daily_caps, number_activated_at, atraso_notar_ms, ms_por_caractere, atraso_minimo_ms, atraso_maximo_ms";

/**
 * `organizations.timezone`, para a tela mostrar o fuso em que o motor avalia a
 * janela de quem não escolheu um no número (`fusoDaJanela`). Falha vira `null`
 * e a tela cai no padrão — é exibição, não pode derrubar a ficha.
 */
export async function lerFusoDaOrganizacao(
  admin: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("organizations")
    .select("timezone")
    .eq("id", orgId)
    .maybeSingle();
  return (data as { timezone?: string | null } | null)?.timezone ?? null;
}

export async function lerPacingDaConexao(admin: SupabaseClient, orgId: string, channelId: string) {
  const { data: session, error } = await admin
    .from("channel_sessions")
    .select("id, daily_message_limit")
    .eq("organization_id", orgId)
    .eq("id", channelId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new PacingError("internal_error", "Falha ao carregar conexão.", 500);
  if (!session)
    throw new PacingError("session_not_found", "Conexão não encontrada nesta organização.", 404);
  const [{ data: row, error: knobError }, fuso] = await Promise.all([
    admin
      .from("channel_knobs")
      .select(KNOB_COLUMNS)
      .eq("organization_id", orgId)
      .eq("channel_session_id", channelId)
      .maybeSingle(),
    lerFusoDaOrganizacao(admin, orgId),
  ]);
  if (knobError) throw new PacingError("internal_error", "Falha ao carregar knobs.", 500);
  return {
    channel_session_id: channelId,
    daily_message_limit: session.daily_message_limit,
    ...knobsView(row as ChannelKnobsRow | null, new Date(), fuso),
  };
}

export async function salvarPacingDaConexao(
  admin: SupabaseClient,
  orgId: string,
  input: PacingKnobsUpdate,
) {
  const {
    channel_session_id,
    daily_message_limit,
    skip_warmup,
    number_activated_at,
    ...camposDiretos
  } = input;
  // `skip_warmup` é pergunta da TELA; a coluna guarda a forma que o motor lê.
  // A tradução mora aqui, num lugar só: a tela não deveria precisar conhecer o
  // formato dos degraus para dizer "este número já está aquecido".
  const knobFields = {
    ...camposDiretos,
    // `null` na data é "não estou declarando", NUNCA "grave nulo": esta é a
    // única coluna `not null` da tabela, e um null explícito ANULA o
    // `default now()` em vez de cair nele — 23502, e a ficha inteira deixava de
    // salvar para quem nunca informou a data (toda instalação nova). Omitindo,
    // a linha nova nasce com `now()` (idade 0 — o "recém-criado" que a tela
    // promete) e a linha existente preserva a data que já tem, em vez de
    // rejuvenescer o número em silêncio de volta ao teto de 20 envios/dia.
    ...(number_activated_at != null ? { number_activated_at } : {}),
    ...(skip_warmup !== undefined
      ? { warmup_daily_caps: skip_warmup ? [...WARMUP_PULADO] : null }
      : {}),
  };

  const { data: session, error: sessionError } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("id", channel_session_id)
    .eq("organization_id", orgId)
    // O MESMO filtro do GET, e não por simetria: sem ele a tela sumia com a
    // conexão excluída e a rota continuava aceitando gravar knobs e teto diário
    // nela — configuração viva pendurada num canal que não envia mais, à espera
    // de confundir quem investigar o próximo envio que não saiu.
    .is("archived_at", null)
    .maybeSingle();
  if (sessionError) throw new PacingError("internal_error", "Falha ao carregar conexão.", 500);
  if (!session) {
    throw new PacingError(
      "session_not_found",
      "Conexão não encontrada nesta organização.",
      404,
      {},
    );
  }

  // Valida a JANELA RESULTANTE (enviado sobre o estado atual): update parcial
  // não pode deixar start >= end no efetivo.
  const { data: currentRow, error: currentError } = await admin
    .from("channel_knobs")
    .select(KNOB_COLUMNS)
    .eq("organization_id", orgId)
    .eq("channel_session_id", channel_session_id)
    .maybeSingle();
  if (currentError) throw new PacingError("internal_error", "Falha ao carregar knobs.", 500);
  const merged: ChannelKnobsRow = {
    ...((currentRow as unknown as ChannelKnobsRow) ?? {
      throttle_ms: null,
      jitter_max_ms: null,
      window_start_hour: null,
      window_end_hour: null,
      resposta_start_hour: null,
      resposta_end_hour: null,
      atraso_notar_ms: null,
      ms_por_caractere: null,
      atraso_minimo_ms: null,
      atraso_maximo_ms: null,
      allow_sunday: null,
      timezone: null,
      warmup_daily_caps: null,
    }),
    ...knobFields,
  };
  const eff = effectiveKnobs(merged);
  if (!windowIsValid(eff.windowStartHour, eff.windowEndHour)) {
    throw new PacingError(
      "validation_failed",
      `Janela inválida: início (${eff.windowStartHour}h) precisa ser antes do fim (${eff.windowEndHour}h).`,
      422,
      {},
    );
  }
  // A janela da RESPOSTA é validada pelo mesmo par-resultante (0495). Sem isto,
  // a tela aceitaria `resposta_start_hour=22, end=7`, que o motor traduz em
  // "nunca responde" — e o operador só descobriria quando o cliente parasse de
  // receber resposta, que é o sintoma que ele não consegue ligar para a tela.
  // `0..24` passa por `windowIsValid` (0 < 24): é assim que se declara "responde 24h".
  if (!windowIsValid(eff.respostaStartHour, eff.respostaEndHour)) {
    throw new PacingError(
      "validation_failed",
      `Janela de resposta inválida: início (${eff.respostaStartHour}h) precisa ser antes do fim (${eff.respostaEndHour}h). Use 0 e 24 para responder a qualquer hora.`,
      422,
      {},
    );
  }
  // Atraso humano (0499), pelo mesmo par-resultante: com os dois gravados o
  // CHECK do banco recusaria e a tela leria um 500 genérico; com só o mínimo
  // acima do teto padrão, o clamp ignoraria o mínimo sem aviso.
  if (eff.atrasoMinimoMs > eff.atrasoMaximoMs) {
    throw new PacingError(
      "validation_failed",
      `Atraso humano inválido: o mínimo (${eff.atrasoMinimoMs} ms) precisa ser menor ou igual ao máximo (${eff.atrasoMaximoMs} ms).`,
      422,
      {},
    );
  }

  if (Object.keys(knobFields).length > 0) {
    const { error: upErr } = await admin.from("channel_knobs").upsert(
      {
        organization_id: orgId,
        channel_session_id,
        ...knobFields,
      },
      { onConflict: "organization_id,channel_session_id" },
    );
    if (upErr) {
      // Mostra só o nome de um campo que esta rota conhece. O texto cru do
      // Postgres pode trazer SQL ou outros dados internos.
      const campoRecusado = KNOB_COLUMNS.split(", ").find((campo) =>
        upErr.message.includes(`"${campo}"`),
      );
      throw new PacingError("internal_error", "Falha ao salvar os knobs.", 500, {
        publicField: campoRecusado,
      });
    }
  }

  if (daily_message_limit !== undefined) {
    const { error: dlErr } = await admin
      .from("channel_sessions")
      .update({ daily_message_limit })
      .eq("id", channel_session_id)
      .eq("organization_id", orgId);
    if (dlErr) {
      throw new PacingError("internal_error", "Falha ao salvar o teto diário.", 500, {});
    }
  }

  return lerPacingDaConexao(admin, orgId, channel_session_id);
}
