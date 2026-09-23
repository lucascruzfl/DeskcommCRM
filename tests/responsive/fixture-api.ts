// No credentials, Supabase client or production fallback in the layout bench.
async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Unmocked fixture: ${method} ${url}`);
  return response.json() as Promise<T>;
}
export const apiClient = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) => request<T>(url, "POST", body),
  patch: <T>(url: string, body?: unknown) => request<T>(url, "PATCH", body),
  delete: <T>(url: string) => request<T>(url, "DELETE"),
};
