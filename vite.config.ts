import { defineConfig } from "vite-plus";

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
      "packages/hosted-contract/dist/**",
      ".alchemy/**",
      ".wrangler/**",
      "**/.wrangler/**",
    ],
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
  fmt: {
    ignorePatterns: [
      "node_modules/**",
      "**/node_modules/**",
      "hosted/apps/account/dist/**",
      "hosted/apps/account/src/routeTree.gen.ts",
      "hosted/apps/marketing/dist/**",
      "hosted/apps/marketing/.astro/**",
      "hosted/apps/api/dist/**",
      "packages/hosted-contract/dist/**",
      ".alchemy/**",
      ".wrangler/**",
      "**/.wrangler/**",
      "apps/**/*.xcassets/**",
    ],
    singleQuote: false,
    semi: true,
    sortPackageJson: true,
  },
  staged: {
    "*.{js,ts,jsx,tsx,vue,svelte,json,jsonc,css,md}": "vp check --fix",
  },
});
