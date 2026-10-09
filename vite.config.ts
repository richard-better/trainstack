import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "vite-plus";

const hostedPackages = [
  "hosted/infra",
  ...readdirSync(join(import.meta.dirname, "hosted/apps")).map((app) => `hosted/apps/${app}`),
]
  .map((directory) => join(import.meta.dirname, directory, "package.json"))
  .filter((manifest) => existsSync(manifest))
  .map((manifest) => JSON.parse(readFileSync(manifest, "utf8")).name);

// See LICENSING.md: packages and the app must not depend on FSL-licensed hosted code.
const noHostedImports = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: [...hostedPackages.flatMap((name) => [name, `${name}/**`]), "**/hosted/**"],
          message: "Code under hosted/ is FSL-licensed. See LICENSING.md.",
        },
      ],
    },
  ],
};

export default defineConfig({
  lint: {
    ignorePatterns: [
      "node_modules/**",
      "**/node_modules/**",
      "hosted/apps/account/dist/**",
      "hosted/apps/account/src/routeTree.gen.ts",
      "hosted/apps/marketing/dist/**",
      "hosted/apps/marketing/.astro/**",
      "hosted/apps/api/dist/**",
      "packages/contract/dist/**",
      ".alchemy/**",
      ".wrangler/**",
      "**/.wrangler/**",
    ],
    options: {
      typeAware: false,
      typeCheck: false,
    },
    overrides: [{ files: ["packages/**", "apps/**"], rules: noHostedImports }],
  },
  fmt: {
    ignorePatterns: [
      "**/LICENSE*",
      "node_modules/**",
      "**/node_modules/**",
      "hosted/apps/account/dist/**",
      "hosted/apps/account/src/routeTree.gen.ts",
      "hosted/apps/marketing/dist/**",
      "hosted/apps/marketing/.astro/**",
      "hosted/apps/api/dist/**",
      "packages/contract/dist/**",
      ".alchemy/**",
      ".wrangler/**",
      "**/.wrangler/**",
      "apps/**/*.xcassets/**",
      ".agents/skills/swift-concurrency-pro/**",
      ".agents/skills/swift-testing-pro/**",
      ".agents/skills/swiftdata-pro/**",
      ".agents/skills/swiftui-pro/**",
    ],
    singleQuote: false,
    semi: true,
    sortPackageJson: true,
  },
  staged: {
    "*.{js,ts,jsx,tsx,vue,svelte,json,jsonc,css,md}": "vp check --fix",
  },
});
