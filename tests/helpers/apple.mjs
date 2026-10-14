import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { api } from "./worker.mjs";

/** Exercises real Apple token verification against a local signing key, without calling Apple. */
export function mockApple() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = {
    ...publicKey.export({ format: "jwk" }),
    kid: "test-apple",
    alg: "RS256",
    use: "sig",
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return {
    fetch(request) {
      assert.equal(request.url, "https://appleid.apple.com/auth/keys");
      return Response.json({ keys: [key] });
    },
    async signIn(runtime, { email = `${randomUUID()}@example.com`, subject = email } = {}) {
      const nonce = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const payload = [
        encode({ alg: key.alg, kid: key.kid }),
        encode({
          iss: "https://appleid.apple.com",
          aud: "com.trainstackhq.ride",
          sub: subject,
          email,
          email_verified: true,
          name: "Test Rider",
          nonce: createHash("sha256").update(nonce).digest("hex"),
          iat: now,
          exp: now + 600,
        }),
      ].join(".");
      const signature = sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url");
      const response = await runtime.dispatchFetch(`${api}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "apple",
          idToken: { token: `${payload}.${signature}`, nonce },
        }),
      });
      assert.equal(response.status, 200, await response.clone().text());
      const token = response.headers.get("set-auth-token");
      assert.ok(token, "the session token is exposed for the app to keep");
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const { user } = await response.json();
      return { email, token, cookie, user, response };
    },
  };
}
