import { resolve, sep } from "node:path";
import { env } from "@trainstack/prehab-env/server";
import { s3 } from "./s3";

export function localMediaPath(key: string): string {
  if (!env.MEDIA_DIRECTORY) throw new Error("Local media directory is not configured");
  const root = resolve(env.MEDIA_DIRECTORY);
  const path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error("Invalid media path");
  return path;
}

export const media = {
  exists: (key: string) =>
    env.MEDIA_DIRECTORY ? Bun.file(localMediaPath(key)).exists() : s3.exists(key),
  file: (key: string) => {
    if (!env.MEDIA_DIRECTORY) return s3.file(key);
    const file = Bun.file(localMediaPath(key));
    return {
      stat: async () => ({ size: file.size }),
      slice: (start: number, end: number) => file.slice(start, end),
      arrayBuffer: () => file.arrayBuffer(),
    };
  },
};
