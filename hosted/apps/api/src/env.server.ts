/// <reference types="@cloudflare/workers-types" />
import type {} from "../cloudflare-env";
// Read native Worker bindings, including STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET, via ENV.
// cloudflare-env.d.ts infers their types from alchemy.run.ts.
export { env as ENV } from "cloudflare:workers";
