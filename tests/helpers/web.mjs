import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApiClient } from "../../hosted/apps/account/src/lib/client.ts";
import { browserThatDoesNotFollowRedirects } from "./browser.mjs";
import { api, origin, rpcClient } from "./worker.mjs";

let lastAddress = 0;

function fromItsOwnAddress(runtime) {
  lastAddress += 1;
  const address = `198.51.100.${lastAddress}`;
  return {
    dispatchFetch(url, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("cf-connecting-ip", address);
      return runtime.dispatchFetch(url, { ...init, headers });
    },
  };
}

export async function signInOnTheWeb(runtime, apple, callbackURL = `${origin}/`) {
  const subject = `001234.${randomUUID()}`;
  const email = `${randomUUID()}@example.com`;
  const browser = browserThatDoesNotFollowRedirects(fromItsOwnAddress(runtime));
  const started = await browser.visit(`${api}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "apple", callbackURL, errorCallbackURL: callbackURL }),
  });
  assert.equal(started.status, 200, await started.clone().text());
  const { form } = apple.authorize((await started.json()).url, { email, subject });
  const posted = await browser.visit(`${api}/api/auth/callback/apple`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://appleid.apple.com",
    },
    body: form.toString(),
  });
  const back = await browser.visit(posted.headers.get("location"));
  const webApp = createApiClient(api, async (request) => {
    const headers = new Headers(request.headers);
    headers.set("Origin", origin);
    const response = await browser.visit(request.url, {
      method: request.method,
      headers,
      body: request.body ? await request.arrayBuffer() : undefined,
    });
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: Object.fromEntries(response.headers),
    });
  });
  const ride = rpcClient(runtime, {
    token: (await apple.signIn(fromItsOwnAddress(runtime), { email, subject })).token,
  });
  return { back, webApp, ride };
}
