import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig(({ mode }) => {
  const mock = loadEnv(mode, '.', '').VITE_PROBE_MOCK === '1'
  return {
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: mock ? 'http://127.0.0.1:8788' : 'http://127.0.0.1:8787', ws: true },
      ...(mock ? { '/__qa': 'http://127.0.0.1:8788' } : {}),
    },
  },
  }
})
