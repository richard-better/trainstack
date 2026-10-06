# Licensing

TrainStack uses a different license for each part of the repository. The directory a file
lives in decides its license.

| Path            | License                                              | What it covers                                                                  |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `hosted/`       | [FSL-1.1-ALv2](hosted/LICENSE.md) (source-available) | Everything that runs trainstackhq.com: the API, website, account app, and infra |
| `packages/*`    | [Apache-2.0](packages/contract/LICENSE), per package | Shared building blocks, including the API contract clients build on             |
| Everything else | [AGPL-3.0-only](LICENSE)                             | The TrainStack app, tests, tooling, and docs                                    |

A package directory with its own `LICENSE` file uses that license. Each workspace
`package.json` declares its license as an SPDX identifier, and `bun run test` checks that
it matches the directory.

## What this means

- **The app is open source.** You can use, modify, and redistribute it under the AGPL. If
  you run a modified version as a network service, you must offer its source to its users.
- **The hosted backend is source-available.** You can read, modify, and run it for any
  purpose except a competing product or service. Self-hosting TrainStack for yourself,
  your club, or your organization is a permitted use. Each version becomes available under
  Apache-2.0 two years after its release.
- **Packages are permissive.** Anyone can build on the API contract and other shared
  packages, including in closed-source software.

## Boundaries

Dependencies may only point in these directions:

- `hosted/` may depend on `packages/*`.
- The app may depend on `packages/*`, but never on `hosted/`.
- `packages/*` may not depend on `hosted/` or the app.

Lint rules and `tests/licenses.test.mjs` enforce these boundaries, and the same test
restricts third-party dependencies to licenses compatible with all three.
