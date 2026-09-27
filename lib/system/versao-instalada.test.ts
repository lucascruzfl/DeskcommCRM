import { describe, expect, it } from "vitest";
import { versaoInstalada } from "./versao-instalada";

describe("release instalada e revisão do host", () => {
  it("APP_VERSION vence a release do checkout", () => {
    expect(versaoInstalada("1.47.0-mcp", "v1.99.0")).toEqual({
      current_version: "1.47.0-mcp",
      build_revision: null,
    });
  });
  it("SHA sozinho nunca vira versão de release", () => {
    expect(versaoInstalada(undefined, "fa06399e1")).toEqual({
      current_version: "",
      build_revision: "fa06399e1",
    });
  });
  it("release e SHA ficam em campos distintos", () => {
    expect(versaoInstalada("1.53.0-mcp", "fa06399e1")).toEqual({
      current_version: "1.53.0-mcp",
      build_revision: "fa06399e1",
    });
  });
  it("sem metadata da imagem aceita a release confirmada pelo host", () => {
    expect(versaoInstalada("dev", "v2.0.0-mcp", "abc123456")).toEqual({
      current_version: "v2.0.0-mcp",
      build_revision: "abc123456",
    });
  });
  it("uma release MCP futura não exige alteração de código", () => {
    expect(versaoInstalada(" 42.7.19-mcp ", "v1.0.0").current_version).toBe("42.7.19-mcp");
  });
  it("sem metadata não inventa release nem revisão", () => {
    expect(versaoInstalada(undefined, "")).toEqual({ current_version: "", build_revision: null });
    expect(versaoInstalada("fa06399e1", "?")).toEqual({
      current_version: "",
      build_revision: null,
    });
  });
});
