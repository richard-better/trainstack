# Self-Host Exercise Videos Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Adapted's Supabase CDN with self-hosted exercise videos — MinIO locally, Cloudflare R2 in production — using presigned URLs served through the existing Fastify API.

**Architecture:** Videos are downloaded from YouTube (referenced by `youtubeId` in the exercise catalogue), stored as `exercises/{exerciseId}/demo.mp4` in an S3-compatible bucket. Server generates presigned URLs at request time. Locally, MinIO serves as the S3 backend; in production, Cloudflare R2. The native app already uses `expo-video` with a URL — only the URL source changes.

**Tech Stack:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, MinIO (Docker), Cloudflare R2 (Pulumi), `yt-dlp` (video download script)

---

## Task 1: Add MinIO to Docker Compose

**Files:**

- Modify: `.dev/docker-compose.yaml`
- Create: `.dev/scripts/minio-entrypoint.sh`

**Step 1: Create the MinIO entrypoint script**

Create `.dev/scripts/minio-entrypoint.sh` (following OA pattern at `/Users/richard/dev/gh/richard-better/oa/.dev/scripts/minio-entrypoint.sh`):

```bash
#!/bin/sh

# Start MinIO in the background
minio server /data --console-address ":9001" &

# Wait for MinIO to be ready
until mc alias set myminio http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do
  echo "Waiting for MinIO to be ready..."
  sleep 1
done

# Create bucket (matching R2 bucket name)
mc mb --ignore-existing myminio/prehab-media

# Make media bucket publicly readable (matches R2 public access for dev)
mc anonymous set download myminio/prehab-media

echo "MinIO ready — bucket: prehab-media"
echo "Console: http://localhost:9013"

# Keep container running
wait
```

**Step 2: Add MinIO service to docker-compose.yaml**

Add after the `jaeger` service in `.dev/docker-compose.yaml`:

```yaml
app-minio:
  image: quay.io/minio/minio
  command: server /data --console-address ":9001"
  restart: unless-stopped
  environment:
    - MINIO_ROOT_USER=minio_root_user
    - MINIO_ROOT_PASSWORD=minio_root_password
  ports:
    - 9012:9000 # S3 API
    - 9013:9001 # Console UI
  volumes:
    - minio_data:/data
    - ./scripts/minio-entrypoint.sh:/minio_entrypoint.sh
  entrypoint: ["/bin/sh", "/minio_entrypoint.sh"]
```

Add `minio_data:` to the `volumes:` section.

Port choices: 9012/9013 to avoid clashing with OA's 9010/9011.

**Step 3: Test MinIO starts**

```bash
docker compose -f .dev/docker-compose.yaml up app-minio -d
docker compose -f .dev/docker-compose.yaml logs app-minio
# Expected: "MinIO ready — bucket: prehab-media"
```

**Step 4: Commit**

```bash
git add .dev/docker-compose.yaml .dev/scripts/minio-entrypoint.sh
git commit -m "feat: add MinIO to docker-compose for local S3-compatible storage"
```

---

## Task 2: Add S3 env vars to env schema and .env.example

**Files:**

- Modify: `packages/env/src/server.ts`
- Modify: `.env.example`

**Step 1: Add S3 env vars to .env.example**

Add this section after the `OTEL_EXPORTER_OTLP_ENDPOINT` line:

```env
# Object Storage (S3-compatible: MinIO locally, Cloudflare R2 in prod)
S3_ENDPOINT=http://localhost:9012
S3_REGION=auto
S3_ACCESS_KEY=minio_root_user
S3_SECRET_KEY=minio_root_password
S3_MEDIA_BUCKET=prehab-media
S3_FORCE_PATH_STYLE=true
```

Also add these same values to the actual `.env` file.

**Step 2: Add S3 env vars to server env schema**

In `packages/env/src/server.ts`, add inside the `server: { ... }` object:

```typescript
S3_ENDPOINT: z.string().url(),
S3_REGION: z.string().default("auto"),
S3_ACCESS_KEY: z.string().min(1),
S3_SECRET_KEY: z.string().min(1),
S3_MEDIA_BUCKET: z.string().default("prehab-media"),
S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
```

**Step 3: Verify types pass**

```bash
bun run check-types
```

**Step 4: Commit**

```bash
git add packages/env/src/server.ts .env.example
git commit -m "feat: add S3 env vars for media storage"
```

---

## Task 3: Create S3 client library

**Files:**

- Create: `apps/server/src/lib/s3.ts`
- Modify: `apps/server/package.json` (add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)

**Step 1: Install S3 SDK packages**

```bash
cd apps/server && bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Commit package.json + bun.lock immediately to avoid lock conflicts:

```bash
git add apps/server/package.json bun.lock
git commit -m "chore: add @aws-sdk/client-s3 and s3-request-presigner"
```

**Step 2: Create the S3 client**

Create `apps/server/src/lib/s3.ts` following OA pattern at `/Users/richard/dev/gh/richard-better/oa/apps/backend/src/lib/s3.ts`:

```typescript
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@prehab-app/env/server";

const s3Client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

export async function getMediaPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: env.S3_MEDIA_BUCKET,
      Key: key,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function putMediaObject(
  key: string,
  body: Buffer | ReadableStream,
  contentType: string,
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.S3_MEDIA_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function mediaObjectExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: env.S3_MEDIA_BUCKET,
        Key: key,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export { s3Client };
```

**Step 3: Verify types pass**

```bash
bun run check-types
```

**Step 4: Commit**

```bash
git add apps/server/src/lib/s3.ts
git commit -m "feat: add S3 client library for media storage"
```

---

## Task 4: Update exercise video URL resolution to use S3

**Files:**

- Modify: `apps/server/src/services/constants/exercises.ts` — remove `ADAPTED_CDN`, update `getDemoUrl` / `getThumbnailUrl`
- Modify: `apps/server/src/rpc/router.ts` — make `withVideoAssets` async (uses presigned URLs)
- Modify: `apps/server/src/services/session-generator.ts` — make `enrichWithVideoUrl` async
- Modify: `apps/server/src/db/seed.ts` — update seed to use new URL pattern

**Step 1: Update exercises.ts — remove Adapted CDN, add S3 key helpers**

Replace the `ADAPTED_CDN`, `getDemoUrl`, and `getThumbnailUrl` block with:

```typescript
/**
 * S3 key patterns for exercise media.
 * Actual files stored as: exercises/{id}/demo.mp4, exercises/{id}/thumbnail.png
 */
export function exerciseDemoKey(exerciseId: string): string {
  return `exercises/${exerciseId}/demo.mp4`;
}

export function exerciseThumbnailKey(exerciseId: string): string {
  return `exercises/${exerciseId}/thumbnail.png`;
}
```

**Step 2: Update router.ts — make withVideoAssets async**

In `apps/server/src/rpc/router.ts`, update imports to use new functions and the S3 presigner:

```typescript
import {
  exercises as exerciseCatalogue,
  exerciseDemoKey,
  exerciseThumbnailKey,
} from "../services/constants/exercises";
import { getMediaPresignedUrl } from "../lib/s3";
```

Update `withVideoAssets`:

```typescript
async function withVideoAssets(ex: (typeof exerciseCatalogue)[number]) {
  const demoUrl = await getMediaPresignedUrl(exerciseDemoKey(ex.id));
  const thumbnailUrl = await getMediaPresignedUrl(exerciseThumbnailKey(ex.id));
  return { ...ex, demoUrl, thumbnailUrl };
}
```

Update `listExercises` handler to await all:

```typescript
return { exercises: await Promise.all(filtered.map(withVideoAssets)) };
```

Update `getExercise` handler similarly.

**Step 3: Update session-generator.ts — make enrichWithVideoUrl async**

Update imports:

```typescript
import {
  findExerciseByName,
  exerciseDemoKey,
  getExerciseNamesForSports,
} from "./constants/exercises";
import { getMediaPresignedUrl } from "../lib/s3";
```

Update `enrichWithVideoUrl`:

```typescript
async function enrichWithVideoUrl(aiSession: AISession): Promise<GeneratedSession> {
  return {
    title: aiSession.title,
    estimatedDurationMin: aiSession.estimatedDurationMin,
    exercises: await Promise.all(
      aiSession.exercises.map(async (ex) => {
        const catalogueEx = findExerciseByName(ex.name);
        const exerciseId = catalogueEx?.id ?? ex.name.toLowerCase().replace(/\s+/g, "-");
        const videoUrl = await getMediaPresignedUrl(exerciseDemoKey(exerciseId));
        return {
          id: exerciseId,
          name: ex.name,
          sets: ex.sets,
          reps: ex.reps,
          durationSec: ex.durationSec,
          restSec: ex.restSec,
          side: ex.side,
          formCues: ex.formCues,
          videoUrl,
        };
      }),
    ),
  };
}
```

Update all callers of `enrichWithVideoUrl` to `await` it.

**Step 4: Update seed.ts**

Replace `getDemoUrl` import with `exerciseDemoKey` + `getMediaPresignedUrl` and await.

**Step 5: Verify types pass**

```bash
bun run check-types
```

**Step 6: Commit**

```bash
git add apps/server/src/services/constants/exercises.ts apps/server/src/rpc/router.ts apps/server/src/services/session-generator.ts apps/server/src/db/seed.ts
git commit -m "feat: switch exercise video URLs from Adapted CDN to S3 presigned URLs"
```

---

## Task 5: Create video download script

**Files:**

- Create: `scripts/download-exercise-videos.ts`

This is a Bun script that:

1. Reads all `youtubeId` values from the exercise catalogue
2. Downloads each video using `yt-dlp` (must be installed via nix/brew)
3. Uploads each video to the configured S3 bucket under `exercises/{exerciseId}/demo.mp4`

**Step 1: Create the download script**

```typescript
/**
 * Download exercise videos from YouTube and upload to S3 (MinIO locally).
 *
 * Prerequisites: yt-dlp installed (brew install yt-dlp / nix)
 *
 * Usage: bun run scripts/download-exercise-videos.ts
 *
 * Environment: reads S3_* vars from .env
 */
import { exercises } from "../apps/server/src/services/constants/exercises";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Load .env
import "dotenv/config";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION || "auto",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

const bucket = process.env.S3_MEDIA_BUCKET || "prehab-media";
const tmpDir = join(import.meta.dir, "../.tmp/videos");

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function downloadAndUpload(exercise: (typeof exercises)[number]) {
  const s3Key = `exercises/${exercise.id}/demo.mp4`;

  // Skip if already uploaded
  if (await objectExists(s3Key)) {
    console.log(`✓ ${exercise.id} — already in S3`);
    return;
  }

  const localPath = join(tmpDir, `${exercise.id}.mp4`);

  // Download from YouTube if not cached locally
  if (!existsSync(localPath)) {
    const url = `https://www.youtube.com/watch?v=${exercise.youtubeId}`;
    console.log(`↓ ${exercise.id} — downloading ${url}`);
    try {
      await $`yt-dlp -f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]" --merge-output-format mp4 -o ${localPath} ${url}`;
    } catch (err) {
      console.error(`✗ ${exercise.id} — download failed: ${err}`);
      return;
    }
  }

  // Upload to S3
  console.log(`↑ ${exercise.id} — uploading to S3`);
  const fileData = await Bun.file(localPath).arrayBuffer();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: Buffer.from(fileData),
      ContentType: "video/mp4",
    }),
  );
  console.log(`✓ ${exercise.id} — done`);
}

// Main
mkdirSync(tmpDir, { recursive: true });

console.log(`\nDownloading ${exercises.length} exercise videos...\n`);
console.log(`S3 endpoint: ${process.env.S3_ENDPOINT}`);
console.log(`S3 bucket: ${bucket}\n`);

// Process sequentially to avoid overwhelming YouTube
for (const exercise of exercises) {
  if (!exercise.youtubeId) {
    console.log(`⊘ ${exercise.id} — no youtubeId, skipping`);
    continue;
  }
  await downloadAndUpload(exercise);
}

console.log("\nDone!");
```

**Step 2: Add `.tmp/` to `.gitignore`**

```
.tmp/
```

**Step 3: Verify script loads correctly**

```bash
bun run scripts/download-exercise-videos.ts --help 2>&1 | head -5
# Should not crash on import
```

**Step 4: Commit**

```bash
git add scripts/download-exercise-videos.ts .gitignore
git commit -m "feat: add video download script (yt-dlp → S3)"
```

---

## Task 6: Add R2 bucket to Pulumi infra

**Files:**

- Create: `infra/r2.ts`
- Modify: `infra/index.ts` — import r2 exports

**Step 1: Create infra/r2.ts**

Follow OA pattern at `/Users/richard/dev/gh/richard-better/oa/infra/r2.ts`:

```typescript
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const cfAccountId = config.require("cloudflare-account-id");

// ========================================
// R2 Buckets
// ========================================

const mediaBucket = new cloudflare.R2Bucket("prehab-media", {
  accountId: cfAccountId,
  name: "prehab-media",
  location: "ENAM",
});

// R2 API credentials (created manually in Cloudflare dashboard → R2 → Manage API Tokens)
const r2AccessKey = config.requireSecret("r2-access-key");
const r2SecretKey = config.requireSecret("r2-secret-key");
const r2Endpoint = pulumi.interpolate`https://${cfAccountId}.r2.cloudflarestorage.com`;

// ========================================
// Exports
// ========================================

export const R2_ENDPOINT = r2Endpoint;
export const R2_ACCESS_KEY = r2AccessKey;
export const R2_SECRET_KEY = r2SecretKey;
export const R2_MEDIA_BUCKET = mediaBucket.name;
```

**Step 2: Import in infra/index.ts**

Add at the bottom of `infra/index.ts`:

```typescript
export { R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY, R2_MEDIA_BUCKET } from "./r2";
```

**Step 3: Verify infra types**

```bash
cd infra && bun run tsc --noEmit
```

**Step 4: Commit**

```bash
git add infra/r2.ts infra/index.ts
git commit -m "feat: add Cloudflare R2 media bucket to Pulumi infra"
```

---

## Task 7: Run video download and verify end-to-end

**Step 1: Start MinIO**

```bash
docker compose -f .dev/docker-compose.yaml up app-minio -d
```

**Step 2: Run the download script**

```bash
bun run scripts/download-exercise-videos.ts
```

This will download all ~44 exercise videos from YouTube and upload them to MinIO. Takes ~10-20 minutes depending on connection.

**Step 3: Verify MinIO has the files**

Open MinIO console at http://localhost:9013 (login: minio_root_user / minio_root_password) and check the `prehab-media` bucket has `exercises/*/demo.mp4` files.

**Step 4: Start the server and verify presigned URLs work**

```bash
cd apps/server && bun run dev
```

Hit the exercise list endpoint and verify `demoUrl` fields contain presigned MinIO URLs that return video content.

**Step 5: Test on the native app**

Start the Expo dev server and verify videos load in the session runner.

---

## Notes

- **No Cloudflare Stream needed** — R2 with presigned URLs is simpler, cheaper, and matches the OA pattern. Cloudflare Stream is for transcoding/adaptive bitrate which we don't need yet (videos are short exercise demos).
- **Production upload** — After R2 is provisioned, the same download script works by swapping env vars to point at R2 instead of MinIO.
- **Thumbnail generation** — Not in scope here. Currently `getThumbnailUrl` points to Adapted. We can generate thumbnails from the downloaded videos as a follow-up (ffmpeg frame extraction).
- **Human-required follow-up:** Create R2 API token in Cloudflare dashboard and set `r2-access-key` / `r2-secret-key` Pulumi secrets.
