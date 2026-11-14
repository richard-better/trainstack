import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Plugin } from "vite-plus";

import { RECORDINGS_PATH } from "./recording.ts";

export const SHOWCASE_PATH = "/__dev/showcase";

export const recordingsDirectory = (appRoot: string) => join(appRoot, ".showcase", "recordings");

const gallery = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>Showcase - Trainstack</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" />
  </head>
  <body>
    <div id="showcase"></div>
    <script type="module" src="/src/showcase/gallery.tsx"></script>
  </body>
</html>
`;

export function showcase(): Plugin {
  return {
    name: "trainstack-showcase",
    apply: "serve",
    configureServer(server) {
      const recordings = recordingsDirectory(server.config.root);
      server.middlewares.use(async (request, response, next) => {
        const { pathname } = new URL(request.url ?? "/", "http://showcase.invalid");
        if (pathname === SHOWCASE_PATH || pathname === `${SHOWCASE_PATH}/`) {
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(await server.transformIndexHtml(pathname, gallery));
          return;
        }
        const world = /^([a-z-]+)\.json$/.exec(pathname.slice(RECORDINGS_PATH.length + 1));
        if (pathname.startsWith(`${RECORDINGS_PATH}/`) && world) {
          try {
            const body = await readFile(join(recordings, `${world[1]}.json`));
            response.setHeader("content-type", "application/json");
            response.setHeader("cache-control", "no-store");
            response.end(body);
          } catch {
            response.statusCode = 404;
            response.end();
          }
          return;
        }
        next();
      });
    },
  };
}
