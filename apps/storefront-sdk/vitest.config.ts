import { defineConfig } from "vitest/config";

// jsdom workers start slowly when the whole monorepo runs in parallel. One worker, files in sequence, so
// startup never competes with itself; threads start faster than forks.
// setupFiles registers every per-tool renderer up front (see src/test-setup.ts); lazy.test.ts removes them to test loading.
export default defineConfig({ test: { pool: "threads", maxWorkers: 1, fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000, setupFiles: ["./src/test-setup.ts"] } });
