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

declare const encryptedByVault: unique symbol;
export type Encrypted = string & { readonly [encryptedByVault]: true };

const IV_BYTES = 12;

export async function createVault(betterAuthSecret: string) {
  const aes = await derive(
    betterAuthSecret,
    "trainstack-strava-tokens",
    { name: "AES-GCM", length: 256 },
    ["encrypt", "decrypt"],
  );
  const hmac = await derive(
    betterAuthSecret,
    "trainstack-strava-state",
    { name: "HMAC", hash: "SHA-256" },
    ["sign", "verify"],
  );

  return {
    async encrypt(plain: string): Promise<Encrypted> {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const sealed = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aes,
        encoder.encode(plain),
      );
      return toBase64Url(new Uint8Array([...iv, ...new Uint8Array(sealed)])) as Encrypted;
    },

    async decrypt(text: Encrypted): Promise<string | undefined> {
      try {
        const bytes = fromBase64Url(text);
        const opened = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES) },
          aes,
          bytes.slice(IV_BYTES),
        );
        return new TextDecoder().decode(opened);
      } catch {
        return undefined;
      }
    },

    async sign(payload: object) {
      const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
      const signature = await crypto.subtle.sign("HMAC", hmac, encoder.encode(body));
      return `${body}.${toBase64Url(signature)}`;
    },

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
