import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.NODE_ENV === 'production' ? '/mkt-dashboard/' : '/',
  server: {
    port: 5174,
    open: true,
    proxy: {
      // Route /sheets-csv → docs.google.com (server-side, bypasses CORS)
      '/sheets-csv': {
        target: 'https://docs.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sheets-csv/, ''),
        secure: true,
      },
    },
  },
})
