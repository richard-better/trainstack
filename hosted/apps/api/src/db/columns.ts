import { integer, text } from "drizzle-orm/sqlite-core";

import type { Encrypted } from "../strava/crypto";

export const unixSeconds = (name: string) => integer(name);

export const unixMilliseconds = (name: string) => integer(name);

export const encrypted = (name: string) => text(name).$type<Encrypted>();
