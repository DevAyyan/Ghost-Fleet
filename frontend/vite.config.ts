import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// /api is proxied to the FastAPI backend so the browser never needs CORS in dev.
// Override the target with GHOSTFLEET_API=http://host:port.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { "/api": env.GHOSTFLEET_API || "http://127.0.0.1:8000" },
    },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  };
});
