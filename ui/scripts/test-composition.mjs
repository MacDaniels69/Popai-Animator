import { build } from "vite";
import { spawnSync } from "node:child_process";
await build({
  configFile: false,
  logLevel: "warn",
  build: {
    target: "es2022",
    minify: false,
    lib: {
      entry: "tests/composition.test.ts",
      formats: ["es"],
      fileName: () => "composition.test.mjs",
    },
    rollupOptions: { external: ["node:test", "node:assert/strict"] },
    outDir: ".composition-tests",
    emptyOutDir: true,
  },
});
const result = spawnSync(
  process.execPath,
  ["--test", ".composition-tests/composition.test.mjs"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
