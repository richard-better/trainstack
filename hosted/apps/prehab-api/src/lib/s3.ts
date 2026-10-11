import { S3Client } from "bun";
import { env } from "@trainstack/prehab-env/server";

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY,
  secretAccessKey: env.S3_SECRET_KEY,
  bucket: env.S3_MEDIA_BUCKET,
});

/**
 * Public URL for a media object — served through the API server's /media proxy.
 * This avoids iOS ATS issues (HTTP blocked for AVPlayer) and works in both dev and prod.
 */
export function getMediaPublicUrl(key: string): string {
  return `${env.BETTER_AUTH_URL}/media/${key}`;
}

export async function putMediaObject(
  key: string,
  body: Buffer | Blob,
  contentType: string,
): Promise<void> {
  await s3.write(key, body, { type: contentType });
}

export async function mediaObjectExists(key: string): Promise<boolean> {
  return s3.exists(key);
}

export { s3 };
