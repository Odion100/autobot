import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the built bundle loads over file:// inside the shell
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 5173, strictPort: true },
});
