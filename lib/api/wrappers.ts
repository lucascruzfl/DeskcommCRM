/**
 * Wrappers canônicos de API (sucesso e erro).
 *
 * Toda rota `/api/v1/*` DEVE usar `ok()` / `fail()` em vez de NextResponse direto.
 * Garante:
 *  - Formato consistente { data, meta? } / { error: { code, message, details? } }
 *  - Header X-Request-Id correlacionando com audit log
 *  - Status codes corretos (200/201/204/400/401/403/404/409/422/429/500)
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { ApiErrorCode } from "@/lib/api/errors";

// -----------------------------------------------------------------------------
// Tipos públicos
// -----------------------------------------------------------------------------

export type CursorMeta = {
  cursor?: string | null;
  has_more?: boolean;
  total?: number | null;
};

export type ApiSuccess<T> = {
  data: T;
  meta?: CursorMeta & Record<string, unknown>;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type OkOptions = {
  status?: 200 | 201 | 204;
  meta?: ApiSuccess<unknown>["meta"];
  requestId?: string;
  headers?: HeadersInit;
};

export function ok<T>(data: T, opts: OkOptions = {}): NextResponse<ApiSuccess<T>> {
  const { status = 200, meta, requestId, headers } = opts;
  const body: ApiSuccess<T> = meta ? { data, meta } : { data };

  const res = NextResponse.json(body, { status, headers });
  res.headers.set("X-Request-Id", requestId ?? randomUUID());
  return res;
}

type FailOptions = {
  details?: unknown;
  /** Campo público já escolhido pelo handler; nunca passe texto bruto do banco. */
  publicField?: string;
  /** Texto fixo ou construído com dados já autorizados; nunca `error.message`. */
  publicMessage?: string;
  /** Progresso operacional estruturado, sem texto de erro nem payload bruto. */
  publicDetails?: Record<string, unknown>;
  requestId?: string;
  headers?: HeadersInit;
};

export function fail(
  code: ApiErrorCode | (string & {}),
  message: string,
  status: number,
  opts: FailOptions = {},
): NextResponse<ApiError> {
  // Mensagens de banco chegam aqui como `error.message` em handlers legados.
  // O 500 não pode devolver SQL, URLs internas ou credenciais.
  const erroInterno = status === 500;
  const campoSeguro =
    erroInterno && opts.publicField && /^[a-z][a-z0-9_]{0,63}$/.test(opts.publicField)
      ? opts.publicField
      : undefined;
  const body: ApiError = {
    error: {
      code,
      message: erroInterno ? (opts.publicMessage ?? "Não foi possível concluir a operação.") : message,
      ...(erroInterno
        ? opts.publicDetails !== undefined
          ? { details: opts.publicDetails }
          : campoSeguro
          ? { details: { field: campoSeguro } }
          : {}
        : opts.details !== undefined
          ? { details: opts.details }
          : {}),
    },
  };

  const res = NextResponse.json(body, { status, headers: opts.headers });
  res.headers.set("X-Request-Id", opts.requestId ?? randomUUID());
  return res;
}

// -----------------------------------------------------------------------------
// Atalhos comuns
// -----------------------------------------------------------------------------

export const noContent = (requestId?: string) => {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("X-Request-Id", requestId ?? randomUUID());
  return res;
};
