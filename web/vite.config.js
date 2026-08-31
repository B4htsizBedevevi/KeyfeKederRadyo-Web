import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const NO_CACHE_HEADERS = {
  "Cache-Control":
    "no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "Surrogate-Control": "no-store",
};

const GATEWAY_TARGET =
  "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],

  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,

    headers: NO_CACHE_HEADERS,

    proxy: {
      /*
       * Frontend:
       * /api/...
       *
       * Gateway:
       * http://127.0.0.1:8787/api/...
       */
      "/api": {
        target: GATEWAY_TARGET,
        changeOrigin: true,
        secure: false,
      },

      /*
       * Eski /gateway çağrılarını da
       * geriye dönük olarak destekle.
       */
      "/gateway": {
        target: GATEWAY_TARGET,
        changeOrigin: true,
        secure: false,
        rewrite: (path) =>
          path.replace(
            /^\/gateway/,
            "/api"
          ),
      },
    },
  },

  preview: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,

    headers: NO_CACHE_HEADERS,

    proxy: {
      "/api": {
        target: GATEWAY_TARGET,
        changeOrigin: true,
        secure: false,
      },

      "/gateway": {
        target: GATEWAY_TARGET,
        changeOrigin: true,
        secure: false,
        rewrite: (path) =>
          path.replace(
            /^\/gateway/,
            "/api"
          ),
      },
    },
  },

  build: {
    rollupOptions: {
      output: {
        entryFileNames:
          "assets/[name]-[hash].js",

        chunkFileNames:
          "assets/[name]-[hash].js",

        assetFileNames:
          "assets/[name]-[hash][extname]",
      },
    },

    sourcemap: false,

    chunkSizeWarningLimit: 600,
  },
});