import { defineConfig, type ConfigEnv, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig(async (_env: ConfigEnv): Promise<UserConfig> => ({
  plugins: [react()],

  // Tauri espera un puerto fijo y predecible en desarrollo.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "0.0.0.0",
    watch: {
      // Evita recargas infinitas cuando Rust recompila,
      // y conflictos con los archivos de índice de Visual Studio (.vsidx)
      // o de otros IDEs que bloquean archivos en Windows (EBUSY errno -4082).
      ignored: ["**/src-tauri/**", "**/.vs/**", "**/.idea/**", "**/target/**"],
    },
  },

  envPrefix: ["VITE_", "TAURI_ENV_*"],

  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));
