import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Project sites on GitHub Pages are served from /<repository-name>/.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  // The Arena preview is served through a dynamic *.e2b.app host.
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
    restoreMocks: true,
  },
})
