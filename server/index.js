import express from 'express'
import { createServer as createHttpServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDataService } from './data-service.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 5173)
const host = process.env.HOST || '0.0.0.0'
const app = express()
const server = createHttpServer(app)
const dataService = createDataService()

app.disable('x-powered-by')
app.get('/api/matchday', async (_request, response) => {
  response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  try {
    response.json(await dataService.getMatchday())
  } catch (error) {
    console.error('Community feed unavailable:', error.message)
    response.status(503).json({ error: 'Community fixtures are temporarily unavailable.' })
  }
})
app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }))

if (production) {
  const dist = resolve(root, 'dist')
  app.use(express.static(dist, { index: false }))
  app.get('/{*path}', (_request, response) => response.sendFile(resolve(dist, 'index.html')))
} else {
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, hmr: { server }, allowedHosts: ['.e2b.app'] },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

server.listen(port, host, () => console.log(`Pitchside running at http://${host}:${port}`))
