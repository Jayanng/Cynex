import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The dossier is mostly text. Warn early if the bundle creeps.
    chunkSizeWarningLimit: 250,
  },
});
