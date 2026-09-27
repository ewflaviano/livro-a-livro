import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pwaPlugin } from './build/pwa-plugin.ts';

export default defineConfig({ plugins: [react(), pwaPlugin()] });
