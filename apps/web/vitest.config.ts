import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite 7 transforms with esbuild; Vite 8+ with oxc. Setting both keeps JSX working across versions.
  esbuild: { jsx: "automatic" },
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"], pool: "threads", maxWorkers: 1, fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000, setupFiles: ["./test/setup.ts"] },
} as Parameters<typeof defineConfig>[0]);
