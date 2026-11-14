import type { ShowcaseFrame } from "./showcase/frame.ts";

export const showcaseFrame: ShowcaseFrame | null = import.meta.env.DEV
  ? await import("./showcase/frame.ts").then((frame) => frame.frameOfThisPage())
  : null;
