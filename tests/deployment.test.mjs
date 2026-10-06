import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

async function deploy(env = {}) {
  const directory = await mkdtemp(join(tmpdir(), "trainstack-deploy-"));
  const calls = join(directory, "calls");
  await writeFile(
    join(directory, "bunx"),
    '#!/bin/sh\nprintf "%s\\n" "$AXIOM_ENABLED $*" >> "$DEPLOY_TEST_CALLS"\nif [ "$DEPLOY_TEST_FAIL_AXIOM" = "true" ] && [ "$4" = "axiom.run.ts" ]; then exit 7; fi\n',
    { mode: 0o755 },
  );
  const environment = { ...process.env };
  delete environment.AXIOM_TOKEN;
  delete environment.AXIOM_API_KEY;
  delete environment.AXIOM_ENABLED;
  let error;
  try {
    execFileSync("bun", ["deploy.ts", "--stage", "production", "--yes", "--no-input"], {
      cwd: resolve("hosted-infra"),
      env: {
        ...environment,
        BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
        PATH: `${directory}:${process.env.PATH}`,
        DEPLOY_TEST_CALLS: calls,
        ...env,
      },
      stdio: "pipe",
    });
  } catch (cause) {
    error = cause;
  }
  try {
    const recorded = await readFile(calls, "utf8").catch((cause) => {
      if (cause.code === "ENOENT") return "";
      throw cause;
    });
    return { error, calls: recorded.trim() ? recorded.trim().split("\n") : [] };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const cloudflare = "false alchemy deploy --stage production --yes --no-input";
const axiom = "true alchemy deploy --config axiom.run.ts --stage production --yes --no-input";
const cloudflareWithAxiom = "true alchemy deploy --stage production --yes --no-input";

test("missing or blank Axiom tokens deploy only Cloudflare", async () => {
  for (const env of [{}, { AXIOM_TOKEN: "" }, { AXIOM_TOKEN: "  " }]) {
    const result = await deploy(env);
    assert.ifError(result.error);
    assert.deepEqual(result.calls, [cloudflare]);
  }
});

test("configured Axiom deploys its stack before Cloudflare", async () => {
  for (const env of [{ AXIOM_TOKEN: "test-provisioning-token" }, { AXIOM_ENABLED: "true" }]) {
    const result = await deploy(env);
    assert.ifError(result.error);
    assert.deepEqual(result.calls, [axiom, cloudflareWithAxiom]);
  }
});

test("Axiom can be disabled without changing its existing stack", async () => {
  const result = await deploy({ AXIOM_ENABLED: "false", AXIOM_TOKEN: "test-provisioning-token" });
  assert.ifError(result.error);
  assert.deepEqual(result.calls, [cloudflare]);
});

test("Axiom deployment failures stop the deployment instead of silently disabling logs", async () => {
  const result = await deploy({
    AXIOM_TOKEN: "test-provisioning-token",
    DEPLOY_TEST_FAIL_AXIOM: "true",
  });
  assert.ok(result.error);
  assert.deepEqual(result.calls, [axiom]);
});
