import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.pw.ts",
  workers: 1,
  timeout: 30_000,
  outputDir: "../../.superpowers/evidence/responsive",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4319",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    cwd: __dirname + "/../..",
    command: "node_modules/.bin/vite --config tests/responsive/vite.config.ts",
    url: "http://127.0.0.1:4319",
    reuseExistingServer: false,
  },
});
