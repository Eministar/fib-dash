import { defineConfig } from 'vite'

// Feste Werte, die die Tauri-CLI erwartet (devUrl in src-tauri/tauri.conf.json).
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // Leere Konfiguration statt Suche: Sonst greift Vite auf die postcss.config.mjs
  // des Dashboards im Elternordner zu, die Tailwind voraussetzt.
  css: { postcss: {} },
  build: {
    // WebView2 ist immer ein aktuelles Chromium – kein Transpilieren für alte Browser nötig.
    target: 'chrome120',
    outDir: 'dist',
  },
})
