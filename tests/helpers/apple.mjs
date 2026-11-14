import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { api } from "./worker.mjs";

export function mockApple() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = {
    ...publicKey.export({ format: "jwk" }),
    kid: "test-apple",
    alg: "RS256",
    use: "sig",
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const identityToken = (claims) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = [
      encode({ alg: key.alg, kid: key.kid }),
      encode({
        iss: "https://appleid.apple.com",
        email_verified: true,
        iat: now,
        exp: now + 600,
        ...claims,
      }),
    ].join(".");
    return `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}`;
  };
  const unexchangedCodes = new Map();
  const tokenRequests = [];
  const revocations = [];

  async function attemptSignIn(runtime, { email, subject = email }) {
    const nonce = randomUUID();
    const token = identityToken({
      aud: "com.trainstackhq.ride",
      sub: subject,
      email,
      name: "Test Rider",
      nonce: createHash("sha256").update(nonce).digest("hex"),
    });
    return runtime.dispatchFetch(`${api}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "apple", idToken: { token, nonce } }),
    });
  }

  return {
    tokenRequests,
    revocations,
    async fetch(request) {
      switch (request.url) {
        case "https://appleid.apple.com/auth/keys":
          return Response.json({ keys: [key] });
        case "https://appleid.apple.com/auth/token": {
          const form = new URLSearchParams(await request.text());
          tokenRequests.push(form);
          const grant = unexchangedCodes.get(form.get("code"));
          unexchangedCodes.delete(form.get("code"));
          if (!grant) return Response.json({ error: "invalid_grant" }, { status: 400 });
          return Response.json({
            access_token: "apple-access-token",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: `apple-refresh-${grant.subject}`,
            id_token: identityToken({
              aud: form.get("client_id"),
              sub: grant.subject,
              email: grant.email,
            }),
          });
        }
        case "https://appleid.apple.com/auth/revoke":
          revocations.push(new URLSearchParams(await request.text()));
          return new Response(null, { status: 200 });
        default:
          assert.fail(`Unexpected request to ${request.url}`);
      }
    },
    authorize(
      authorizationURL,
      { email = `${randomUUID()}@example.com`, subject = email, name } = {},
    ) {
      const url = new URL(authorizationURL);
      assert.equal(`${url.origin}${url.pathname}`, "https://appleid.apple.com/auth/authorize");
      assert.equal(url.searchParams.get("response_mode"), "form_post");
      const code = randomUUID();
      unexchangedCodes.set(code, { subject, email });
      const form = new URLSearchParams({ code, state: url.searchParams.get("state") });
      if (name) {
        const [firstName, lastName] = name.split(" ");
        form.set("user", JSON.stringify({ name: { firstName, lastName }, email }));
      }
      return { url, form, redirectURI: url.searchParams.get("redirect_uri") };
    },
    appAuthorizationCode({ subject, email = `${randomUUID()}@example.com` }) {
      const code = `c${randomUUID().replaceAll("-", "")}.0.app`;
      unexchangedCodes.set(code, { subject, email });
      return code;
    },
    async signIn(runtime, { email = `${randomUUID()}@example.com`, subject = email } = {}) {
      const response = await attemptSignIn(runtime, { email, subject });
      assert.equal(response.status, 200, await response.clone().text());
      const sessionToken = response.headers.get("set-auth-token");
      assert.ok(sessionToken, "the session token is exposed for the app to keep");
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const { user } = await response.json();
      return { email, token: sessionToken, cookie, user, response };
    },
    attemptSignIn,
  };
}
