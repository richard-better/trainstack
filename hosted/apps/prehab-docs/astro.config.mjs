import starlight from "@astrojs/starlight";
// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "http://localhost:4323",
  integrations: [
    starlight({
      title: "TrainStack Prehab",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/trainstackhq/trainstack" },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            // Each item here is one entry in the navigation menu.
            { label: "Local development", slug: "guides/example" },
          ],
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
        },
      ],
    }),
  ],
});
