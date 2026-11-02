import assert from "node:assert/strict";
import { test } from "node:test";
import { createVault } from "../hosted/apps/api/src/strava/crypto.ts";

const betterAuthSecret = "test-only-secret-with-at-least-32-characters";
const rotatedSecret = "a-rotated-secret-with-at-least-32-characters";

test("a Strava token is kept encrypted and opens again under the same Better Auth secret", async () => {
  const vault = await createVault(betterAuthSecret);
  const sealed = await vault.encrypt("access-token-value");
  assert.ok(!sealed.includes("access-token-value"));
  assert.notEqual(sealed, await vault.encrypt("access-token-value"));
  assert.equal(await (await createVault(betterAuthSecret)).decrypt(sealed), "access-token-value");
});

test("rotating the Better Auth secret leaves stored Strava tokens and sign-in state unreadable", async () => {
  const before = await createVault(betterAuthSecret);
  const after = await createVault(rotatedSecret);
  assert.equal(await after.decrypt(await before.encrypt("access-token-value")), undefined);
  assert.equal(await after.verify(await before.sign({ link: "sign-in" })), undefined);
});

test("signed sign-in state is refused once it has been changed", async () => {
  const vault = await createVault(betterAuthSecret);
  const signed = await vault.sign({ link: "sign-in", expires: 1 });
  assert.deepEqual(await vault.verify(signed), { link: "sign-in", expires: 1 });
  const [, signature] = signed.split(".");
  const changedBody = Buffer.from(JSON.stringify({ link: "another", expires: 1 })).toString(
    "base64url",
  );
  assert.equal(await vault.verify(`${changedBody}.${signature}`), undefined);
  assert.equal(await vault.verify(`${signed}.extra`), undefined);
  assert.equal(await vault.verify("not-signed"), undefined);
});
