/**
 * Download exercise videos from YouTube and upload to S3 (MinIO locally).
 *
 * Prerequisites: yt-dlp installed (brew install yt-dlp / nix)
 * Usage: bun run scripts/download-exercise-videos.ts
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

const tmpDir = join(import.meta.dir, "../.tmp/videos");

async function downloadAndUpload(exercise: (typeof exercises)[number]) {
  const s3Key = `exercises/${exercise.id}/demo.mp4`;

  if (await s3.exists(s3Key)) {
    console.log(`✓ ${exercise.id} — already in S3`);
    return;
  }

  const localPath = join(tmpDir, `${exercise.id}.mp4`);

  if (!existsSync(localPath)) {
    const url = `https://www.youtube.com/watch?v=${exercise.youtubeId}`;
    console.log(`↓ ${exercise.id} — downloading ${url}`);
    try {
      await Bun.$`yt-dlp -f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]" --merge-output-format mp4 -o ${localPath} ${url}`;
    } catch (err) {
      console.error(`✗ ${exercise.id} — download failed: ${err}`);
      return;
    }
  }

  console.log(`↑ ${exercise.id} — uploading to S3`);
  const fileData = Bun.file(localPath);
  await s3.write(s3Key, fileData, { type: "video/mp4" });
  console.log(`✓ ${exercise.id} — done`);
}

mkdirSync(tmpDir, { recursive: true });

console.log(`\nDownloading ${exercises.length} exercise videos...\n`);
console.log(`S3 endpoint: ${process.env.S3_ENDPOINT}`);
console.log(`S3 bucket: ${process.env.S3_MEDIA_BUCKET}\n`);

for (const exercise of exercises) {
  if (!exercise.youtubeId) {
    console.log(`⊘ ${exercise.id} — no youtubeId, skipping`);
    continue;
  }
  await downloadAndUpload(exercise);
}

console.log("\nDone!");
