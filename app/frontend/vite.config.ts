import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, /api goes to the FastAPI backend (uvicorn on :8000).
export default defineConfig({
  plugins: [react()],
  // Pre-bundling breaks MapLibre's relative web-worker URL ("Worker failed to load"); serve it as-is.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
})
