import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [tanstackStart(), viteReact()],
  server: {
    port: 3001,
    strictPort: true,
  },
});
