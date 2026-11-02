import { importPKCS8, SignJWT } from "jose";

export const APPLE_APP_BUNDLE_ID = "com.trainstackhq.ride";
export const APPLE_SERVICES_ID = "com.trainstackhq.ride.web";
export const APPLE_TEAM_ID = "S64PDPJKMJ";

export type AppleWebConfig = {
  APPLE_SIGN_IN_KEY_ID?: string;
  APPLE_SIGN_IN_PRIVATE_KEY?: string;
};

const SHORT_LIVED_SECRET_LIFETIME_SECONDS = 60 * 60;
const REPLACE_CACHED_SECRET_BEFORE_EXPIRY_SECONDS = 5 * 60;

let cachedForTheIsolate: { keyId: string; secret: string; expires: number } | undefined;

export async function appleClientSecret(env: AppleWebConfig): Promise<string | undefined> {
  const keyId = env.APPLE_SIGN_IN_KEY_ID?.trim();
  const privateKey = env.APPLE_SIGN_IN_PRIVATE_KEY?.trim();
  if (!keyId || !privateKey) return undefined;
  const now = Math.floor(Date.now() / 1000);
  if (
    cachedForTheIsolate?.keyId === keyId &&
    cachedForTheIsolate.expires - REPLACE_CACHED_SECRET_BEFORE_EXPIRY_SECONDS > now
  ) {
    return cachedForTheIsolate.secret;
  }
  const expires = now + SHORT_LIVED_SECRET_LIFETIME_SECONDS;
  const secret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(APPLE_TEAM_ID)
    .setSubject(APPLE_SERVICES_ID)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(expires)
    .sign(await importPKCS8(privateKey, "ES256"));
  cachedForTheIsolate = { keyId, secret, expires };
  return secret;
}

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
