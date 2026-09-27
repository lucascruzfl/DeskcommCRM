/** A imagem em execução decide a release; o checkout do host só informa a revisão. */
export function versaoInstalada(
  appVersion: string | undefined,
  versaoDoHost: string,
  revisaoDoHost?: string | null,
) {
  const release = (value: string) =>
    /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
  const imagem = appVersion?.trim() ?? "";
  const current_version = release(imagem) ? imagem : release(versaoDoHost) ? versaoDoHost : "";
  const sha = revisaoDoHost || (!release(versaoDoHost) ? versaoDoHost : "");
  return {
    current_version,
    build_revision: /^[a-f0-9]{7,40}$/i.test(sha) ? sha : null,
  };
}
