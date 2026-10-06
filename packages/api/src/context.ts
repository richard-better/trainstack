import type { Session } from "@trainstack/auth";
import type { Database } from "@trainstack/db";

export type Context = {
  session: Session | null;
  db: Database;
};
