import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import { showcase } from "./src/showcase/serve.ts";

export default defineConfig({
  plugins: [showcase(), tanstackStart(), viteReact()],
  server: {
    port: 3001,
    strictPort: true,
  },
});
