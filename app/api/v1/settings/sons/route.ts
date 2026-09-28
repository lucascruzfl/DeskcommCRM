import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * /api/v1/settings/sons — os sons dos avisos da Central (a etapa que avisa e o
 * pedido de pessoa), escolhidos pela organização. Ver `lib/notifications/sons-da-org.ts`.
 *
 *   GET    — URL assinada (1 h) de cada som, para a campainha tocar. Qualquer membro.
 *   POST   — multipart `tipo` + `arquivo`. Manager ou acima. Substitui o anterior.
 *   DELETE — `?tipo=`. Manager ou acima. Volta ao bipe do produto.
 *
 * O tipo do arquivo é FAREJADO pelos bytes; o bucket é privado e só o
 * service_role lê e grava (migration 0441). Organização sempre da sessão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import {
  BUCKET_DOS_SONS,
  TAMANHO_MAXIMO_DO_SOM,
  TIPOS_DE_SOM,
  extensaoDoAudio,
  farejarAudio,
  type TipoDeSom,
} from "@/lib/notifications/sons-da-org";
import { createAdminClient } from "@/lib/supabase/admin";
import { lerConfiguracao, gravarSons, restaurarSom } from "@/lib/notifications/configuracao-sons";

export const dynamic = "force-dynamic";

const VALIDADE_SEGUNDOS = 3600;

function ehTipo(v: unknown): v is TipoDeSom {
  return typeof v === "string" && (TIPOS_DE_SOM as readonly string[]).includes(v);
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "settings_sons" });
  if (!authz.ok) return authz.response;

  // Leitura que falhou degrada para o bipe do produto: o aviso toca de qualquer jeito.
  const sons = (await lerConfiguracao(authz.org.orgId))?.sons ?? {};
  const urls: Record<TipoDeSom, string | null> = { venda: null, pessoa: null };
  for (const tipo of TIPOS_DE_SOM) {
    const caminho = sons[tipo];
    if (!caminho) continue;
    const { data } = await createAdminClient().storage.from(BUCKET_DOS_SONS).createSignedUrl(caminho, VALIDADE_SEGUNDOS);
    urls[tipo] = data?.signedUrl ?? null;
  }
  return ok(urls, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_sons" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  // Recusa pelo Content-Length declarado ANTES de bufferizar o corpo (como as
  // rotas de foto do catálogo e de mídia da conversa); o `arquivo.size` abaixo
  // continua sendo o check autoritativo. A folga cobre o envelope multipart.
  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > TAMANHO_MAXIMO_DO_SOM + 64 * 1024) {
    return fail("payload_too_large", t("O som pode ter no máximo 1 MB."), 413, { requestId });
  }

  const form = await req.formData().catch(() => null);
  const tipo = form?.get("tipo");
  const arquivo = form?.get("arquivo");
  if (!ehTipo(tipo) || !(arquivo instanceof File)) {
    return fail("invalid_request", t("Escolha o aviso e o arquivo de som."), 400, { requestId });
  }
  if (arquivo.size > TAMANHO_MAXIMO_DO_SOM) {
    return fail("payload_too_large", t("O som pode ter no máximo 1 MB."), 413, { requestId });
  }
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipoReal = farejarAudio(bytes);
  if (!tipoReal) {
    return fail("unsupported_media_type", t("O som precisa ser MP3, OGG ou WAV."), 415, { requestId });
  }

  // Lê a configuração ANTES de subir: falhar aqui não deixa arquivo órfão.
  const atual = await lerConfiguracao(orgId);
  if (!atual) return fail("internal_error", t("Erro ao salvar o som."), 500, { requestId });

  const caminho = `${orgId}/${tipo}-${randomUUID()}.${extensaoDoAudio(tipoReal)}`;
  const admin = createAdminClient();
  const { error: erroUp } = await admin.storage
    .from(BUCKET_DOS_SONS)
    .upload(caminho, Buffer.from(bytes), { contentType: tipoReal, upsert: false });
  if (erroUp) {
    logger.error("[settings/sons] upload falhou", { detail: erroUp.message, requestId });
    return fail("internal_error", t("Erro ao subir o som."), 500, { requestId });
  }

  const { settings, sons } = atual;
  const anterior = sons[tipo];
  if (!(await gravarSons(orgId, settings, { ...sons, [tipo]: caminho }))) {
    await admin.storage.from(BUCKET_DOS_SONS).remove([caminho]);
    return fail("internal_error", t("Erro ao salvar o som."), 500, { requestId });
  }
  // O arquivo anterior sai DEPOIS de o novo estar gravado: falhar aqui deixa um
  // órfão pequeno, nunca um aviso sem som.
  if (anterior) await admin.storage.from(BUCKET_DOS_SONS).remove([anterior]);

  void audit({
    action: "settings.notification_sound_updated",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: { tipo, bytes: bytes.length, formato: tipoReal },
  });
  return ok({ tipo }, { requestId, status: 201 });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_sons" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const tipo = new URL(req.url).searchParams.get("tipo");
  if (!ehTipo(tipo)) return fail("invalid_request", t("Aviso desconhecido."), 400, { requestId });

  if (!(await restaurarSom(orgId, tipo))) {
    return fail("internal_error", t("Erro ao salvar o som."), 500, { requestId });
  }

  void audit({
    action: "settings.notification_sound_removed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: { tipo },
  });
  return ok({ tipo }, { requestId });
}
