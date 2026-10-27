import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Env files live at the repo root, shared with the agent.
export default defineConfig({ plugins: [react()], envDir: ".." });
