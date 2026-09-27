/** Serviço canônico dos sons: sessão HTTP e MCP usam a mesma gravação por organização. */
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_DOS_SONS, TIPOS_DE_SOM, type TipoDeSom } from "./sons-da-org";

type Sons = Partial<Record<TipoDeSom, string>>;

/**
 * `null` quando a leitura FALHOU — e quem grava tem de parar aí. Tratar a falha
 * como `settings` vazio faria o update seguinte regravar o jsonb inteiro só com
 * `sons_de_aviso`, apagando toda a configuração da organização.
 */
export async function lerConfiguracao(
  orgId: string,
  admin: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<{ settings: Record<string, unknown>; sons: Sons } | null> {
  const { data, error } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data) {
    logger.error("[settings/sons] leitura de organizations.settings falhou", {
      detail: error?.message ?? "organization_not_found",
    });
    return null;
  }
  const settings = ((data as { settings?: Record<string, unknown> } | null)?.settings ??
    {}) as Record<string, unknown>;
  const bruto = settings.sons_de_aviso;
  const sons: Sons = {};
  if (bruto && typeof bruto === "object") {
    for (const tipo of TIPOS_DE_SOM) {
      const caminho = (bruto as Record<string, unknown>)[tipo];
      // Só caminho DESTA organização: a linha é gravável e o bucket é assinado pelo service_role.
      if (typeof caminho === "string" && caminho.startsWith(`${orgId}/`)) sons[tipo] = caminho;
    }
  }
  return { settings, sons };
}

export async function gravarSons(
  orgId: string,
  settings: Record<string, unknown>,
  sons: Sons,
  admin: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<boolean> {
  // Cliente admin: a RLS de `organizations` só deixa platform admin escrever, e
  // com o cliente de sessão isto casaria zero linhas dizendo "sucesso".
  const { error } = await admin
    .from("organizations")
    .update({ settings: { ...settings, sons_de_aviso: sons } })
    .eq("id", orgId);
  return !error;
}

/** Restaura o bipe; a configuração é gravada antes de remover o arquivo antigo. */
export async function restaurarSom(
  orgId: string,
  tipo: TipoDeSom,
  admin: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<boolean> {
  const atual = await lerConfiguracao(orgId, admin);
  if (!atual) return false;
  const { settings, sons } = atual;
  const caminho = sons[tipo];
  const resto = { ...sons };
  delete resto[tipo];
  if (!(await gravarSons(orgId, settings, resto, admin))) return false;
  if (caminho) {
    const { error } = await admin.storage.from(BUCKET_DOS_SONS).remove([caminho]);
    if (error)
      logger.warn("[settings/sons] limpeza do som antigo falhou", { organizationId: orgId });
  }
  return true;
}
