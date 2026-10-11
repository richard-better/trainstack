---
title: Local development
description: Run Prehab without deployment.
---

Use Xcode 27, Bun through mise, and Docker. Copy `hosted/.env.prehab.example` to
`hosted/.env.prehab`, start the Postgres compose service, then run migrations.

```sh
docker compose -f hosted/prehab-local/docker-compose.yaml up -d
mise exec -- bun run --cwd hosted/apps/prehab-api db:migrate
mise exec -- bun run prehab:api
```

Run the worker in a second terminal with `bun run prehab:worker`. With the API
running, `bun run --cwd hosted/apps/prehab-api db:seed` creates local fixtures.
Open `apps/prehab/Prehab.xcodeproj` and choose the iOS or macOS scheme.

The website/admin uses port 4322; this documentation uses port 4323.
A working Google AI key is required for live Coach and generation.
