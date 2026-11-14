import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { encrypted } from "../columns";
import { user } from "./auth";

export const appleAppGrant = sqliteTable("apple_app_grant", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  refreshToken: encrypted("refresh_token").notNull(),
  grantedAt: integer("granted_at", { mode: "timestamp_ms" }).notNull(),
});
