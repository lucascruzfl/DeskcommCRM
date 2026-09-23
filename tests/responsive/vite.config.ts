import { defineConfig } from "vite";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: {
    alias: [
      ...["next/navigation", "@/app/actions/shell/toggleSidebar", "@/hooks/auth/AuthProvider"].map(
        (find) => ({ find, replacement: resolve(import.meta.dirname, "fixture-navigation.ts") }),
      ),
      { find: "@/lib/api/client", replacement: resolve(import.meta.dirname, "fixture-api.ts") },
      { find: "next/link", replacement: resolve(import.meta.dirname, "fixture-link.tsx") },
      { find: "@", replacement: root },
    ],
  },
  css: { postcss: root },
  server: { host: "127.0.0.1", port: 4319, strictPort: true, fs: { allow: [root] } },
});
