import { importPKCS8, SignJWT } from "jose";

/** The Ride app's bundle ID, which Apple puts in the identity token as its audience. */
export const APPLE_APP_BUNDLE_ID = "com.trainstackhq.ride";
/** The Services ID that Apple's web flow signs in to. Apple gives it the same user IDs as Ride. */
export const APPLE_SERVICES_ID = "com.trainstackhq.ride.web";
export const APPLE_TEAM_ID = "S64PDPJKMJ";

export type AppleWebConfig = {
  APPLE_SIGN_IN_KEY_ID?: string;
  APPLE_SIGN_IN_PRIVATE_KEY?: string;
};

/** Apple accepts a client secret for up to six months. One hour keeps a leaked one short-lived. */
const SECRET_LIFETIME_SECONDS = 60 * 60;
/** A cached secret is replaced this long before it runs out, so no request carries a stale one. */
const SECRET_MARGIN_SECONDS = 5 * 60;

let cached: { keyId: string; secret: string; expires: number } | undefined;

/**
 * The client secret for Apple's web flow: a JWT signed with the Sign in with Apple key. It is
 * cached for the isolate, since the auth instance is built for every request. Without the key,
 * there is no web flow and this returns undefined.
 */
export async function appleClientSecret(env: AppleWebConfig): Promise<string | undefined> {
  const keyId = env.APPLE_SIGN_IN_KEY_ID?.trim();
  const privateKey = env.APPLE_SIGN_IN_PRIVATE_KEY?.trim();
  if (!keyId || !privateKey) return undefined;
  const now = Math.floor(Date.now() / 1000);
  if (cached?.keyId === keyId && cached.expires - SECRET_MARGIN_SECONDS > now) {
    return cached.secret;
  }
  const expires = now + SECRET_LIFETIME_SECONDS;
  const secret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(APPLE_TEAM_ID)
    .setSubject(APPLE_SERVICES_ID)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(expires)
    .sign(await importPKCS8(privateKey, "ES256"));
  cached = { keyId, secret, expires };
  return secret;
}

/**
 * Tells Apple the rider no longer uses Ride, so the app leaves their Apple ID's list of apps.
 * Only the web flow leaves a refresh token to revoke.
 */
export async function revokeAppleToken(
  clientSecret: string,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: APPLE_SERVICES_ID,
      client_secret: clientSecret,
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Apple refused to revoke the token: ${response.status}`);
}
