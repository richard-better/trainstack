import { createAuth as createConfiguredAuth } from "./auth";
import { appleClientSecret } from "./auth/apple";
import { type Database, createDb } from "./db";

import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(
    ENV,
    database ?? (await getDb()),
    await webSignInSecretOrNoWebFlowIfTheKeyIsBroken(),
  );
}

async function webSignInSecretOrNoWebFlowIfTheKeyIsBroken() {
  try {
    return await appleClientSecret(ENV);
  } catch (error) {
    console.error(error);
    return undefined;
  }
}
