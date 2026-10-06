/// <reference types="@cloudflare/workers-types" />
/// <reference types="astro/client" />

import type { RequestLogger } from "evlog";

declare global {
  namespace App {
    interface Locals {
      cfContext: ExecutionContext;
      log: RequestLogger;
    }
  }
}
