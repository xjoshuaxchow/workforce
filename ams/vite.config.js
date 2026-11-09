import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/media": {
        target: process.env.WORKFORCE_API_URL ?? "http://127.0.0.1:8310",
        changeOrigin: true,
      },
      "/api": {
        target: process.env.WORKFORCE_API_URL ?? "http://127.0.0.1:8310",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.WORKFORCE_API_URL ?? "http://127.0.0.1:8310",
      },
    },
  },
});
