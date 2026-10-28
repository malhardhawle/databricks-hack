import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, /api goes to the FastAPI backend (uvicorn on :8000).
export default defineConfig({
  plugins: [react()],
  // MapLibre's worker URL is set explicitly in MapView (setWorkerUrl); keeping it un-prebundled also helps dev.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
})
