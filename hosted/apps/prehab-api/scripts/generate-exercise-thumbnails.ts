/**
 * Generate thumbnails from downloaded exercise videos and upload to S3.
 * Extracts a frame at 1 second into each video using ffmpeg.
 *
 * Prerequisites: ffmpeg installed
 * Usage: bun run scripts/generate-exercise-thumbnails.ts
 */
import { exercises } from "../src/services/constants/exercises";
import { S3Client } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION || "auto",
  accessKeyId: process.env.S3_ACCESS_KEY!,
  secretAccessKey: process.env.S3_SECRET_KEY!,
  bucket: process.env.S3_MEDIA_BUCKET || "prehab-media",
});

const videoDir = join(import.meta.dir, "../.tmp/videos");
const thumbDir = join(import.meta.dir, "../.tmp/thumbnails");

async function generateAndUpload(exercise: (typeof exercises)[number]) {
  const s3Key = `exercises/${exercise.id}/thumbnail.png`;

  if (await s3.exists(s3Key)) {
    console.log(`✓ ${exercise.id} — already in S3`);
    return;
  }

  const videoPath = join(videoDir, `${exercise.id}.mp4`);
  const thumbPath = join(thumbDir, `${exercise.id}.png`);

  if (!existsSync(videoPath)) {
    console.log(`⊘ ${exercise.id} — no video file, skipping`);
    return;
  }

  if (!existsSync(thumbPath)) {
    console.log(`⚙ ${exercise.id} — extracting thumbnail`);
    try {
      await Bun.$`ffmpeg -y -i ${videoPath} -ss 00:00:01 -frames:v 1 -q:v 2 ${thumbPath} 2>/dev/null`;
    } catch (err) {
      console.error(`✗ ${exercise.id} — ffmpeg failed: ${err}`);
      return;
    }
  }

  console.log(`↑ ${exercise.id} — uploading thumbnail`);
  const fileData = Bun.file(thumbPath);
  await s3.write(s3Key, fileData, { type: "image/png" });
  console.log(`✓ ${exercise.id} — done`);
}

mkdirSync(thumbDir, { recursive: true });

console.log(`\nGenerating thumbnails for ${exercises.length} exercises...\n`);
console.log(`S3 endpoint: ${process.env.S3_ENDPOINT}`);
console.log(`S3 bucket: ${process.env.S3_MEDIA_BUCKET}\n`);

for (const exercise of exercises) {
  await generateAndUpload(exercise);
}

console.log("\nDone!");
