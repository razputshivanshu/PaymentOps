import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/worker-metrics': { target: 'http://localhost:9090', changeOrigin: true, rewrite: () => '/metrics' } } },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.includes('/node_modules/d3-') || id.includes('/node_modules/internmap/')) return 'chart-utils'
    if (id.includes('/node_modules/recharts/')) return 'charts'
    if (id.includes('/node_modules/lucide-react/')) return 'icons'
    if (id.includes('/node_modules/react/')) return 'react-vendor'
  } } } },
})
