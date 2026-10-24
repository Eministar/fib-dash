import { defineConfig } from 'vite'

// Feste Werte, die die Tauri-CLI erwartet (devUrl in src-tauri/tauri.conf.json).
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    // WebView2 ist immer ein aktuelles Chromium – kein Transpilieren für alte Browser nötig.
    target: 'chrome120',
    outDir: 'dist',
  },
})
