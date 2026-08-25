import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// No GitHub Pages o site vive em /<repositorio>/, não na raiz. Em dev fica na
// raiz mesmo — por isso o base muda conforme o comando.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/derecord/' : '/',
  server: { port: 5173, host: true },
  build: { outDir: 'dist' },
}))
