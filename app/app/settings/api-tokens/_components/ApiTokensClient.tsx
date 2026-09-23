"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useState } from "react";
import { toast } from "sonner";

import {
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
  type CreatedApiToken,
} from "@/hooks/team/useApiTokens";
import { copyToClipboard } from "@/lib/clipboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { MCP_CAPABILITIES, MCP_DOMAINS, MCP_OPERATION_PRESET } from "@/lib/mcp/scopes";

/**
 * `mcp:read`/`mcp:write` faltavam nesta lista, e sem eles NENHUMA ferramenta
 * MCP funciona: toda chamada volta "Token missing required scope 'mcp:read'"
 * (lib/mcp/types.ts exige um dos dois em cada tool). Como esta tela é o único
 * lugar que emite token, o "CRM operável por agentes de IA via MCP" ficava
 * inalcançável — a API sempre aceitou os escopos; só o catálogo daqui os
 * escondia.
 */
const SCOPES: { id: string; label: string }[] = [
  { id: "mcp:read", label: "Agentes de IA podem LER o CRM (MCP)" },
  { id: "mcp:write", label: "Agentes de IA podem AGIR no CRM (MCP)" },
  // Sem isto o token nasce como 'agent' e as ferramentas de nível gerente
  // (criar lead, atribuir conversa) respondem "Role 'agent' insufficient".
  // O papel viaja junto dos escopos (ver lib/mcp/auth.ts) e também não
  // aparecia em lugar nenhum da interface.
  { id: "role:manager", label: "Tratar o token como gerente (necessário p/ criar e atribuir)" },
  { id: "contacts:read", label: "Ler contatos" },
  { id: "contacts:write", label: "Criar e editar contatos" },
  { id: "leads:read", label: "Ler leads" },
  { id: "leads:write", label: "Criar e editar leads" },
  { id: "messages:read", label: "Ler mensagens" },
  { id: "messages:write", label: "Enviar mensagens" },
  { id: "audit:read", label: "Ler o log de auditoria" },
  ...MCP_DOMAINS.filter((domain) => !["contacts", "leads", "messages", "audit"].includes(domain)).flatMap((domain) => [
    { id: `${domain}:read`, label: `Ler o domínio ${domain}` },
    { id: `${domain}:write`, label: `Alterar o domínio ${domain}` },
  ]),
  ...MCP_CAPABILITIES.map((capability) => ({
    id: `capability:${capability}`,
    label: `Autorizar risco: ${capability}`,
  })),
];

export function ApiTokensClient() {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const { data, isLoading } = useApiTokens();
  const create = useCreateApiToken();
  const revoke = useRevokeApiToken();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [created, setCreated] = useState<CreatedApiToken | null>(null);

  const tokens = data?.data ?? [];

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (scopes.length === 0) {
      toast.error(t("Selecione ao menos um escopo."));
      return;
    }
    try {
      const res = await create.mutateAsync({
        name,
        scopes,
        expires_in_days: expiresInDays ? Number(expiresInDays) : undefined,
      });
      setCreated(res.data);
      setName("");
      setScopes([]);
      setExpiresInDays("");
      setCreateOpen(false);
    } catch {
      /* noop */
    }
  };

  const toggleScope = (s: string) => {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  return (
    <>
      <div className="flex sm:justify-end">
        <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto">
          {t("Criar token")}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Nenhum token criado ainda.")}</p>
      ) : (
        <div className="rounded-md border">
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("Nome")}</TableHead>
                <TableHead>{t("Prefixo")}</TableHead>
                <TableHead>{t("Escopos")}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>{t("Expira")}</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((tok) => (
                <TableRow key={tok.id}>
                  <TableCell className="font-medium">{tok.name}</TableCell>
                  <TableCell>
                    <code className="text-xs">{tok.prefix}…</code>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {tok.scopes.map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {tok.revoked_at ? (
                      <Badge variant="destructive">{t("Revogado")}</Badge>
                    ) : (
                      <Badge variant="default">{t("Ativo")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tok.expires_at ? new Date(tok.expires_at).toLocaleDateString(tagDoIdioma) : "—"}
                  </TableCell>
                  <TableCell>
                    {!tok.revoked_at ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revoke.isPending}
                        onClick={async () => {
                          await revoke.mutateAsync(tok.id);
                          toast.success(t("Token revogado."));
                        }}
                      >
                        {t("Revogar")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("Criar novo token")}</DialogTitle>
            <DialogDescription>
              {t("O plaintext será mostrado apenas uma vez.")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form id="create-api-token" onSubmit={onCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="t-name">{t("Nome")}</Label>
                <Input
                  id="t-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("Worker de import")}
                  minLength={2}
                  maxLength={100}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>{t("Escopos")}</Label>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setScopes([...MCP_OPERATION_PRESET])}
                >
                  {t("Selecionar preset: Operação completa via MCP")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t("O preset só é aplicado quando você o escolhe e inclui allowlist explícita de cada ferramenta.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {SCOPES.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => toggleScope(s.id)}
                      title={t(s.label)}
                      aria-label={`${s.id} — ${t(s.label)}`}
                      aria-pressed={scopes.includes(s.id)}
                      className={`min-h-11 max-w-full rounded-md border px-2 py-2 text-left text-xs ${
                        scopes.includes(s.id) ? "border-primary bg-primary/10" : "border-border"
                      }`}
                    >
                      {s.id}
                      <span className="ml-1 text-muted-foreground">· {t(s.label)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-exp">{t("Expira em (dias) — opcional")}</Label>
                <Input
                  id="t-exp"
                  type="number"
                  min={1}
                  max={365}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  placeholder="365"
                />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" form="create-api-token" disabled={create.isPending}>
              {t("Criar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Token criado")}</DialogTitle>
            <DialogDescription>
              {t("Copie e guarde agora — não conseguiremos exibir novamente.")}
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="space-y-3">
              <code className="block break-all rounded-md border bg-muted p-3 text-sm">
                {created.plaintext}
              </code>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void copyToClipboard(created.plaintext).then((ok) => {
                    if (ok) toast.success(t("Token copiado."));
                    else toast.error(t("Não foi possível copiar — selecione o token acima."));
                  });
                }}
              >
                {t("Copiar para clipboard")}
              </Button>
              <p className="text-xs text-muted-foreground">{created._warning}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>{t("Fechar")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
