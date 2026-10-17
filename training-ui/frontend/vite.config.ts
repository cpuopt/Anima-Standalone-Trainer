import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const backend = process.env.TRAINER_BACKEND_URL || 'http://127.0.0.1:3000'
export default defineConfig({
  base: '/ui/',
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { commonjsOptions: { include: [/node_modules/, /public[\\/]js/] } },
  server: {
    port: 5173,
    proxy: {
      '/api': backend, '/tensorboard': backend, '/uploads': backend,
      '^/$': { target: backend, ws: true, bypass(req) { if (req.headers.upgrade?.toLowerCase() !== 'websocket') return req.url } },
    },
  },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], restoreMocks: true },
})
