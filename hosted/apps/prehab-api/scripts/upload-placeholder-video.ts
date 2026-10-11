/**
 * Upload the shared placeholder video to S3/R2.
 * Usage: bun run scripts/upload-placeholder-video.ts
 */
import { PLACEHOLDER_VIDEO_KEY } from "../src/services/constants/exercises";
import { S3Client } from "bun";
import { join } from "node:path";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9012",
  region: process.env.S3_REGION || "auto",
  accessKeyId: process.env.S3_ACCESS_KEY || "minio_root_user",
  secretAccessKey: process.env.S3_SECRET_KEY || "minio_root_password",
  bucket: process.env.S3_MEDIA_BUCKET || "prehab-media",
});

const videoFile = Bun.file(join(import.meta.dir, "../.tmp/placeholder.mp4"));
const videoBytes = await videoFile.arrayBuffer();

console.log(`\nUploading placeholder video...`);
console.log(`S3 endpoint: ${process.env.S3_ENDPOINT || "http://localhost:9012"}`);
console.log(`Key: ${PLACEHOLDER_VIDEO_KEY}`);
console.log(`Size: ${(videoBytes.byteLength / 1024).toFixed(0)} KB\n`);

await s3.write(PLACEHOLDER_VIDEO_KEY, videoBytes, { type: "video/mp4" });

console.log(`✓ Done!`);
