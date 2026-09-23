import { test, expect, type Page, type Locator } from "@playwright/test";

const viewports = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [412, 915],
  [430, 932],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
  [390, 360], // reduced available height, e.g. keyboard; not an OS keyboard simulation
] as const;
const long = "ConexaoSemEspacos".repeat(8);
const impact = {
  outcome: "archive",
  history: { conversations: 42, messages: 100, voice_calls: 0, agent_versions: 4 },
  configuration: { ai_routers: 2, channel_knobs: 1 },
};

async function contained(locator: Locator, page: Page) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  if (["dialog", "alertdialog"].includes((await locator.getAttribute("role")) ?? "")) {
    expect(await locator.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  if (await locator.evaluate((el) => el.tagName === "BUTTON" && !el.matches(":disabled"))) {
    expect(
      await locator.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
    ).toBe(true);
  }
}
async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(() => {
      // Existing global clipping must not conceal a broken child in this audit.
      const style = document.createElement("style");
      style.textContent = "html, body { overflow: visible !important; }";
      document.head.append(style);
      try {
        return document.documentElement.scrollWidth - document.documentElement.clientWidth;
      } finally {
        style.remove();
      }
    }),
  ).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      let data: unknown;
      if (path === "/api/v1/settings/api-tokens") {
        data =
          route.request().method() === "POST"
            ? {
                ...JSON.parse(route.request().postData()!),
                plaintext: "dsk_fixture_" + "a".repeat(100),
                _warning: "Token de teste",
              }
            : [
                {
                  id: "fixture",
                  name: long,
                  prefix: "dsk_test",
                  scopes: ["mcp:read"],
                  revoked_at: null,
                },
              ];
      } else if (path === "/api/v1/channel-sessions") {
        data = [
          {
            id: "fixture",
            provider: "meta_cloud",
            display_name: long,
            waha_session_name: null,
            phone_number: "5511999999999",
            status: "WORKING",
          },
        ];
      } else if (path.endsWith("/ai-access")) data = { mode: "open", test_phone_numbers: [] };
      else if (path.endsWith("/routing/channels")) data = { channels: [] };
      else if (path === "/api/v1/system/version")
        data = { current_version: "1.42.0", is_owner: false };
      else if (["/api/v1/pipelines", "/api/v1/contacts"].includes(path)) data = [];
      else if (path === "/api/v1/ai/pacing") data = { items: [] };
      else if (path === "/api/v1/channel-sessions/fixture") {
        data =
          route.request().method() === "DELETE"
            ? { id: "fixture", archived: true, impact }
            : { deletion_impact: impact };
      } else throw new Error(`Missing fixture for ${path}`);
      await route.fulfill({ json: { data } });
    },
  );
});

for (const [width, height] of viewports) {
  test.describe(`${width}x${height}`, () => {
    test.use({ viewport: { width, height } });
    test("API Tokens: scopes, fixed actions and submit", async ({ page }) => {
      await page.goto("/?view=tokens");
      await page.getByRole("button", { name: "Criar token", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await contained(dialog, page);
      await contained(dialog.getByRole("button", { name: "Criar", exact: true }), page);
      await page.getByLabel("Nome", { exact: true }).fill("Token responsivo");
      await dialog.getByRole("button", { name: /^mcp:read/ }).click();
      await page.getByLabel("Expira em (dias) — opcional").fill("30");
      await contained(dialog.getByRole("button", { name: "Criar", exact: true }), page);
      await contained(dialog.getByRole("heading"), page);
      await noPageOverflow(page);
      await page.screenshot({
        path: `.superpowers/evidence/responsive/tokens-${width}x${height}.png`,
      });
      await dialog.getByRole("button", { name: "Criar", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Token criado" })).toBeVisible();
      await page.getByRole("button", { name: "Fechar", exact: true }).last().click();
      await noPageOverflow(page);
    });
    test("connection deletion: long title and reachable actions", async ({ page }) => {
      await page.goto("/?view=connections");
      await page.getByRole("button", { name: `Excluir ${long}`, exact: true }).click();
      const dialog = page.getByRole("dialog");
      const remove = dialog.getByRole("button", { name: "Excluir", exact: true });
      await expect(remove).toBeEnabled();
      await contained(dialog, page);
      await contained(remove, page);
      await contained(dialog.getByRole("button", { name: "Cancelar", exact: true }), page);
      await contained(dialog.getByRole("heading"), page);
      await noPageOverflow(page);
      await page.screenshot({
        path: `.superpowers/evidence/responsive/connection-${width}x${height}.png`,
      });
      const deletion = page.waitForRequest((r) => r.method() === "DELETE");
      await remove.click();
      await deletion;
      await expect(dialog).toBeHidden();
    });
    test("forms and navigation consumers", async ({ page }) => {
      await page.goto("/?view=forms");
      for (const name of ["Contato", "Lead", "Tarefa", "Webhook", "Follow-up"]) {
        await page.getByRole("button", { name, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await contained(dialog, page);
        const actions = dialog.locator('button[type="submit"]');
        await actions.scrollIntoViewIfNeeded();
        await contained(actions, page);
        expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(
          1,
        );
        await page.keyboard.press("Escape");
        await noPageOverflow(page);
      }
      await page.goto("/?view=navigation");
      if (width < 768) {
        await page.getByRole("button", { name: "Abrir navegação" }).click();
        await contained(page.getByRole("dialog"), page);
        const link = page.getByRole("dialog").getByRole("link").last();
        await link.scrollIntoViewIfNeeded();
        await contained(link, page);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();
        await expect(page.getByRole("button", { name: "Abrir navegação" })).toBeFocused();
      } else {
        await contained(page.locator("aside"), page);
      }
      await noPageOverflow(page);
    });
    test("primitives: local scroll, dialogs, menus, sheet and tabs", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Formulário longo" })).toBeVisible();
      await noPageOverflow(page);
      // First tab remains reachable; centered overflowing flex rows lose it.
      const tabs = page.getByRole("tablist");
      const first = page.getByRole("tab", { name: "Configuração 0" });
      expect((await first.boundingBox())!.x).toBeGreaterThanOrEqual((await tabs.boundingBox())!.x);
      await first.focus();
      await page.keyboard.press("End");
      await expect(page.getByRole("tab", { name: "Configuração 7" })).toBeFocused();
      await page.getByRole("button", { name: "Formulário longo" }).click();
      await contained(page.getByRole("dialog"), page);
      const save = page.getByRole("button", { name: "Salvar alterações do formulário" });
      await save.scrollIntoViewIfNeeded();
      await contained(save, page);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Confirmação", exact: true }).click();
      await contained(page.getByRole("alertdialog"), page);
      const confirm = page.getByRole("button", { name: "Confirmar exclusão definitivamente" });
      await confirm.scrollIntoViewIfNeeded();
      await contained(confirm, page);
      await confirm.click();
      await page.getByRole("button", { name: "Abrir painel" }).click();
      await contained(page.getByRole("dialog"), page);
      const savePanel = page.getByRole("button", { name: "Salvar painel" });
      await savePanel.scrollIntoViewIfNeeded();
      await contained(savePanel, page);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Filtro", exact: true }).click();
      await contained(page.getByRole("dialog"), page);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await contained(page.getByRole("menu"), page);
      await page.keyboard.press("Escape");
      await page.getByRole("combobox").click();
      await contained(page.getByRole("listbox"), page);
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await noPageOverflow(page);
    });
  });
}
