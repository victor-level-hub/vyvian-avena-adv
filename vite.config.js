import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Source maps públicos: só são descarregados quando o DevTools abre —
    // não pesam para o visitante — e limpam o aviso "missing source maps
    // for large first-party JavaScript" do Lighthouse.
    sourcemap: true,
  },
})
