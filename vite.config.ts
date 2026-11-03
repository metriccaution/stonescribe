import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true },
  server: {
    proxy: { "/api": "http://localhost:3001" },
  },
  test: { include: ["src/**/*.test.ts"] },
});
