import type { ApiEnv } from "@trainstack/hosted-infra/alchemy.run";

export type CloudflareEnv = ApiEnv;

declare global {
  type Env = CloudflareEnv;
}

declare module "cloudflare:workers" {
  namespace Cloudflare {
    export interface Env extends CloudflareEnv {}
  }
}
