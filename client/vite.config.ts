import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3001'

const proxy = {
  '/api': {
    target: API_TARGET,
    changeOrigin: true
  },
  '/socket.io': {
    target: API_TARGET,
    ws: true
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy },
  // preview 也需要代理：用生产构建产物本地验收时，前端仍然要能打到 API
  preview: { proxy }
})
