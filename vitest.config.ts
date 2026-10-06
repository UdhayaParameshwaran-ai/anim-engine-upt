import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve @anim/* to package sources so tests never depend on a stale build.
const packages = fileURLToPath(new URL("./packages", import.meta.url));
const alias = Object.fromEntries(readdirSync(packages).map((name) => [`@anim/${name}`, `${packages}/${name}/src/index.ts`]));

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
