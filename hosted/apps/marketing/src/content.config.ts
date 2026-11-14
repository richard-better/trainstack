import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const help = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/help" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    section: z.enum(["Start", "Activities", "Training", "Plan", "Log", "Account"]),
    order: z.number().int(),
  }),
});

export const collections = { help };
