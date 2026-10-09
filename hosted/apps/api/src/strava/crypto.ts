const encoder = new TextEncoder();

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

type DerivedKeyAlgorithm = Parameters<SubtleCrypto["deriveKey"]>[2];
type DerivedKeyUsages = Parameters<SubtleCrypto["deriveKey"]>[4];

async function derive(
  secret: string,
  info: string,
  algorithm: DerivedKeyAlgorithm,
  usages: DerivedKeyUsages,
) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode(info) },
    material,
    algorithm,
    false,
    usages,
  );
}

/**
 * What the Strava routes need to keep in the database or hand to a browser: tokens encrypted so a
 * copy of the database is no use on its own, and state signed so a sign-in can only be finished by
 * the rider who started it. Both keys come from the Better Auth secret, so there is no second
 * secret to look after. Changing that secret makes riders connect Strava again.
 */
export async function createVault(secret: string) {
  const aes = await derive(secret, "trainstack-strava-tokens", { name: "AES-GCM", length: 256 }, [
    "encrypt",
    "decrypt",
  ]);
  const hmac = await derive(secret, "trainstack-strava-state", { name: "HMAC", hash: "SHA-256" }, [
    "sign",
    "verify",
  ]);

  return {
    async encrypt(plain: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aes,
        encoder.encode(plain),
      );
      return toBase64Url(new Uint8Array([...iv, ...new Uint8Array(sealed)]));
    },

    async decrypt(text: string): Promise<string | undefined> {
      try {
        const bytes = fromBase64Url(text);
        const opened = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: bytes.slice(0, 12) },
          aes,
          bytes.slice(12),
        );
        return new TextDecoder().decode(opened);
      } catch {
        return undefined;
      }
    },

    /** `payload` with a signature, to hand out and check when it comes back. */
    async sign(payload: object) {
      const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
      const signature = await crypto.subtle.sign("HMAC", hmac, encoder.encode(body));
      return `${body}.${toBase64Url(signature)}`;
    },

    /** The payload `sign` made, or nothing if it was changed. */
    async verify<T>(signed: string): Promise<T | undefined> {
      const [body, signature, ...extra] = signed.split(".");
      if (!body || !signature || extra.length > 0) return undefined;
      try {
        const valid = await crypto.subtle.verify(
          "HMAC",
          hmac,
          fromBase64Url(signature),
          encoder.encode(body),
        );
        return valid ? (JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as T) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export type Vault = Awaited<ReturnType<typeof createVault>>;
