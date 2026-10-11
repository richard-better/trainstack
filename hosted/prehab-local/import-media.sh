#!/usr/bin/env bash
set -euo pipefail
# Import existing exercise assets without checking large videos into Git.
source_dir="${1:?Usage: import-media.sh /path/to/prehab-app}"
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
media_dir="$repo_dir/hosted/apps/prehab-api/.prehab-media/exercises"
mkdir -p "$media_dir"
shopt -s nullglob
for video in "$source_dir"/.tmp/videos/*.mp4; do
  exercise_id="$(basename "$video" .mp4)"
  mkdir -p "$media_dir/$exercise_id"
  cp "$video" "$media_dir/$exercise_id/demo.mp4"
done
for thumbnail in "$source_dir"/.tmp/thumbnails/*.png; do
  exercise_id="$(basename "$thumbnail" .png)"
  mkdir -p "$media_dir/$exercise_id"
  cp "$thumbnail" "$media_dir/$exercise_id/thumbnail.png"
done
mkdir -p "$media_dir/placeholder"
if [[ -f "$source_dir/.tmp/placeholder.mp4" ]]; then cp "$source_dir/.tmp/placeholder.mp4" "$media_dir/placeholder/demo.mp4"; fi
if [[ -f "$source_dir/.tmp/placeholder-thumbnail.png" ]]; then cp "$source_dir/.tmp/placeholder-thumbnail.png" "$media_dir/placeholder/thumbnail.png"; fi
printf 'Imported local media into %s\n' "$media_dir"
