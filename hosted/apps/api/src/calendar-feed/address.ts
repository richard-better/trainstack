import { derive, fromBase64Url, toBase64Url } from "../strava/crypto";

const FEED_ID_BYTES = 16;
const FEED_ID_LENGTH = 22;
const SIGNATURE_LENGTH = 43;
const TOKEN = new RegExp(`^[A-Za-z0-9_-]{${FEED_ID_LENGTH + SIGNATURE_LENGTH}}$`);
const encoder = new TextEncoder();

export const FEEDS_ROUTE = "/feeds/calendar";
const feedPath = (token: string) => `${FEEDS_ROUTE}/${token}.ics`;

export const newFeedId = () => toBase64Url(crypto.getRandomValues(new Uint8Array(FEED_ID_BYTES)));

async function addressesFor(betterAuthSecret: string) {
  const key = await derive(
    betterAuthSecret,
    "trainstack-calendar-feed",
    { name: "HMAC", hash: "SHA-256" },
    ["sign", "verify"],
  );

  return {
    async pathOf(feedId: string) {
      const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(feedId));
      return feedPath(`${feedId}${toBase64Url(signature)}`);
    },

    async feedIdOf(file: string): Promise<string | undefined> {
      if (!file.endsWith(".ics")) return undefined;
      const token = file.slice(0, -".ics".length);
      if (!TOKEN.test(token)) return undefined;
      const feedId = token.slice(0, FEED_ID_LENGTH);
      const written = token.slice(FEED_ID_LENGTH);
      const signature = fromBase64Url(written);
      if (toBase64Url(signature) !== written) return undefined;
      const signed = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(feedId));
      return signed ? feedId : undefined;
    },
  };
}

type FeedAddresses = Awaited<ReturnType<typeof addressesFor>>;
const addressesBySecret = new Map<string, Promise<FeedAddresses>>();

export function feedAddresses(betterAuthSecret: string) {
  let addresses = addressesBySecret.get(betterAuthSecret);
  if (!addresses) {
    addresses = addressesFor(betterAuthSecret);
    addressesBySecret.set(betterAuthSecret, addresses);
  }
  return addresses;
}
