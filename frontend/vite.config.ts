import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// /api is proxied to the FastAPI backend so the browser never needs CORS in dev.
// Override the target with GHOSTFLEET_API=http://host:port in the environment or in .env.local, for example the live
// site, to work on the frontend without running the backend or holding a Global Fishing Watch token.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      // changeOrigin sends the target's own host name, which a hosted API (GHOSTFLEET_API=https://...) needs to route the request
      proxy: { "/api": { target: env.GHOSTFLEET_API || "http://127.0.0.1:8000", changeOrigin: true } },
    },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  };
});
