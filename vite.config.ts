import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/upload': { target: 'http://localhost:8787' },
      '/uploads': { target: 'http://localhost:8787' },
    },
  },
  build: { outDir: 'dist' },
})
