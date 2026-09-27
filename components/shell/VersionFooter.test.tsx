import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemVersion } from "@/hooks/system/useSystemVersion";
import { VersionFooter } from "./VersionFooter";

const state = vi.hoisted(() => ({ data: null as SystemVersion | null }));
vi.mock("@/hooks/system/useSystemVersion", () => ({ useSystemVersion: () => state }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
afterEach(cleanup);

describe("versão no rodapé", () => {
  it("exibe a release MCP inteira e revisão secundária", () => {
    state.data = { current_version: "42.7.19-mcp", build_revision: "abc123456", is_owner: false };
    render(<VersionFooter collapsed={false} />);
    expect(screen.getByText("Versão 42.7.19-mcp")).toBeTruthy();
    expect(screen.getByText("Build abc123456")).toBeTruthy();
    expect(screen.queryByText("Versão abc123456")).toBeNull();
  });
  it("sem release só apresenta Build", () => {
    state.data = { current_version: "", build_revision: "abc123456", is_owner: false };
    render(<VersionFooter collapsed={false} />);
    expect(screen.getByText("Build abc123456")).toBeTruthy();
    expect(screen.queryByText(/Versão/)).toBeNull();
  });
  it("a release permanece no título quando o menu está recolhido", () => {
    state.data = { current_version: "v42.7.19-mcp", is_owner: false };
    render(<VersionFooter collapsed />);
    expect(screen.getByTitle("Versão 42.7.19-mcp")).toBeTruthy();
  });
});
