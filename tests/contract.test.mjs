import assert from "node:assert/strict";
import { test } from "node:test";
import { rolldown } from "rolldown";

test("shared contract bundles for browser clients without server implementations", async () => {
  const bundle = await rolldown({
    input: "packages/hosted-contract/src/index.ts",
    platform: "browser",
  });
  try {
    const { output } = await bundle.generate({ format: "esm" });
    const modules = output.flatMap((chunk) =>
      chunk.type === "chunk" ? Object.keys(chunk.modules) : [],
    );
    assert.ok(modules.some((id) => id.includes("/@orpc/contract/")));
    assert.deepEqual(
      modules.filter(
        (id) => /\/@orpc\/(server|openapi|zod)\//.test(id) || id.includes("/hosted/apps/api/"),
      ),
      [],
    );
  } finally {
    await bundle.close();
  }
});
