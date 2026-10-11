---
title: Project map
description: App, service and contract boundaries.
---

| Directory                      | Responsibility                                    |
| ------------------------------ | ------------------------------------------------- |
| `apps/prehab/PrehabKit`        | Shared Swift core, API and SwiftUI features       |
| `apps/prehab/PrehabiOS`        | iOS application target                            |
| `apps/prehab/PrehabmacOS`      | macOS application target                          |
| `packages/prehab-contract`     | oRPC schemas and onboarding questions             |
| `hosted/apps/prehab-api`       | Authentication, Postgres, jobs, pi-durable, media |
| `hosted/apps/prehab-web`       | Marketing, account pages and admin                |
| `hosted/packages/prehab-email` | Transactional email templates                     |

Regenerate native response models with `bun run prehab:contract` after contract
changes. Run `bun run prehab:test` for backend and Swift tests. See
`docs/prehab/migration.md` for verification details and external prerequisites.
