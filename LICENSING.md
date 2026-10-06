# Licensing

TrainStack is licensed under [AGPL-3.0-only](LICENSE), except for two kinds of directory:

| Path                             | License                                              | Why                                                                                  |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `hosted/`                        | [FSL-1.1-ALv2](hosted/LICENSE.md) (source-available) | Everything that runs trainstackhq.com: the API, website, account app, and infra      |
| A package with its own `LICENSE` | That license, which must be permissive               | Chosen explicitly when other code needs to build on it, such as `hosted/` or clients |
| Everything else                  | [AGPL-3.0-only](LICENSE)                             | The TrainStack app, packages, tests, tooling, and docs                               |

Packages that chose a permissive license:

- `packages/contract` (Apache-2.0): the API contract. `hosted/` implements it, and clients build on it.
- `packages/config` (Apache-2.0): shared TypeScript configuration that `hosted/` builds with.

Each workspace `package.json` declares its license as an SPDX identifier, and `bun run test`
checks it against these rules.

## What this means

- **TrainStack is open source by default.** You can use, modify, and redistribute it under
  the AGPL. If you run a modified version as a network service, you must offer its source
  to its users.
- **The hosted backend is source-available.** You can read, modify, and run it for any
  purpose except a competing product or service. Self-hosting TrainStack for yourself,
  your club, or your organization is a permitted use. Each version becomes available under
  Apache-2.0 two years after its release.
- **Permissive packages are free to build on,** including in closed-source software.

## Boundaries

Dependencies may only point in these directions:

- `hosted/` may depend on permissive packages, never on AGPL code.
- AGPL code may depend on AGPL and permissive packages, never on `hosted/`.
- Permissive packages may only depend on other permissive packages.

To let `hosted/` use an AGPL package, give that package a permissive license first.

Lint rules and `tests/licenses.test.mjs` enforce these boundaries, and the same test
restricts third-party dependencies to licenses compatible with all three.

## Trademarks

None of these licenses grant rights to the TrainStack name or logo. See
[TRADEMARKS.md](TRADEMARKS.md).

## Contributing

Contributions require signing the [Contributor License Agreement](CLA.md). See
[CONTRIBUTING.md](CONTRIBUTING.md).
