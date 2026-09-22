import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
  },
  ssr: {
    external: ['@electric-sql/pglite', 'pg'],
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite', 'pg'],
  },
  plugins: [tailwindcss(), tanstackStart({ srcDirectory: 'src' }), viteReact(), nitro()],
})
