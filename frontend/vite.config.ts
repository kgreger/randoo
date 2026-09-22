import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // Served under demo.konstantingreger.net/randoo/ in production (see
  // demo-vps-infra's nginx config), so every asset URL the production
  // build emits needs this prefix baked in. `base` affects Vite's own
  // dev server too, not just `vite build` - conditioning it on `command`
  // keeps `npm run dev` at "/" (localhost:5173), the README's documented
  // workflow, unchanged.
  base: command === "build" ? "/randoo/" : "/",
  plugins: [react()],
}));
