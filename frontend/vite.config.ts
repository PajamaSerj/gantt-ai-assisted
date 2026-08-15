import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'frappe-gantt-css': fileURLToPath(
        new URL('./node_modules/frappe-gantt/dist/frappe-gantt.css', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
