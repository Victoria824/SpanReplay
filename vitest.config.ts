import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/bin/**"],
      thresholds: {
        statements: 70,
        branches: 50,
        functions: 65,
        lines: 75,
      },
    },
  },
});
