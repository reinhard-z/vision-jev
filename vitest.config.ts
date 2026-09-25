import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't boot the Cloudflare plugin.
export default defineConfig({
  test: { include: ["src/**/*.test.ts", "worker/**/*.test.ts", "shared/**/*.test.ts"] },
});
