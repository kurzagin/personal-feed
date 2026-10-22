import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@personal-feed/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        path.resolve(__dirname, "../../packages"),
      ],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on("error", (err, _req, _res) => {
            // Suppress noisy EPIPE or ECONNRESET logs when client aborts or resets upload streams
            if ((err as any).code === "EPIPE" || (err as any).code === "ECONNRESET") {
              return;
            }
            console.error("[vite proxy error]", err.message);
          });
        },
      },
    },
  },
});
