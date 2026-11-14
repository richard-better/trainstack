import { decodeJwt, importPKCS8, SignJWT } from "jose";

export const APPLE_APP_BUNDLE_ID = "com.trainstackhq.ride";
export const APPLE_SERVICES_ID = "com.trainstackhq.ride.web";
export const APPLE_TEAM_ID = "S64PDPJKMJ";

export type AppleWebConfig = {
  APPLE_SIGN_IN_KEY_ID?: string;
  APPLE_SIGN_IN_PRIVATE_KEY?: string;
};

const SHORT_LIVED_SECRET_LIFETIME_SECONDS = 60 * 60;
const REPLACE_CACHED_SECRET_BEFORE_EXPIRY_SECONDS = 5 * 60;

const cachedForTheIsolate = new Map<string, { keyId: string; secret: string; expires: number }>();

export type AppleClientId = typeof APPLE_SERVICES_ID | typeof APPLE_APP_BUNDLE_ID;

export async function appleClientSecret(
  env: AppleWebConfig,
  clientId: AppleClientId = APPLE_SERVICES_ID,
): Promise<string | undefined> {
  const keyId = env.APPLE_SIGN_IN_KEY_ID?.trim();
  const privateKey = env.APPLE_SIGN_IN_PRIVATE_KEY?.trim();
  if (!keyId || !privateKey) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const cached = cachedForTheIsolate.get(clientId);
  if (
    cached?.keyId === keyId &&
    cached.expires - REPLACE_CACHED_SECRET_BEFORE_EXPIRY_SECONDS > now
  ) {
    return cached.secret;
  }
  const expires = now + SHORT_LIVED_SECRET_LIFETIME_SECONDS;
  const secret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(APPLE_TEAM_ID)
    .setSubject(clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(expires)
    .sign(await importPKCS8(privateKey, "ES256"));
  cachedForTheIsolate.set(clientId, { keyId, secret, expires });
  return secret;
}

export async function revokeAppleToken(
  clientSecret: string,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
  clientId: AppleClientId = APPLE_SERVICES_ID,
) {
  const response = await fetcher("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Apple refused to revoke the token: ${response.status}`);
}

export type AppleTokens = { refreshToken: string; subject: string };

export async function exchangeAppAuthorizationCode(
  clientSecret: string,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<AppleTokens | "refused"> {
  const response = await fetcher("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: APPLE_APP_BUNDLE_ID,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (response.status === 400) return "refused";
  if (!response.ok) throw new Error(`Apple answered the code exchange with ${response.status}`);
  const tokens = (await response.json()) as { refresh_token?: string; id_token?: string };
  const claims = tokens.id_token ? decodeJwt(tokens.id_token) : {};
  if (
    !tokens.refresh_token ||
    typeof claims.sub !== "string" ||
    claims.aud !== APPLE_APP_BUNDLE_ID
  ) {
    throw new Error("Apple's answer to the code exchange lacks a refresh token or a subject");
  }
  return { refreshToken: tokens.refresh_token, subject: claims.sub };
}
