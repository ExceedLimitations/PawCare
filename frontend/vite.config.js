import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/feedings': 'http://localhost:3000',
      '/sensor': 'http://localhost:3000',
      '/status': 'http://localhost:3000',
      '/schedules': 'http://localhost:3000',
      '/feed': 'http://localhost:3000',
      '/login': 'http://localhost:3000',
      '/profile': 'http://localhost:3000',
      '/socket.io': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    }
  }
})
