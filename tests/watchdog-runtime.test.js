// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

// Exercise the bundled entrypoint in Cloudflare's actual local workerd runtime.
// All outbound traffic is intercepted; the URLs and ledger below are fake.
const config = readFileSync(resolve('watchdog/wrangler.toml'), 'utf8')
const compatibilityDate = config.match(/^compatibility_date\s*=\s*"([^"]+)"/m)?.[1]
const cron = config.match(/crons\s*=\s*\[\s*"([^"]+)"/)?.[1]
const hour = 60 * 60 * 1000
const pingUrl = 'https://hc-ping.com/test-only-secret'
let bundledWorker

beforeAll(async () => {
  expect(compatibilityDate).toBeTruthy()
  expect(cron).toBe('43 * * * *')
  const result = await build({ entryPoints: ['watchdog/worker.js'], bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' })
  bundledWorker = result.outputFiles[0].text
})

async function runScheduled({ ageHours = 0, publication = 'github-pages', pingStatus = 200, pingBody = 'OK', secret = pingUrl } = {}) {
  const now = Date.now()
  const ledger = {
    version: 1, startedAt: new Date(now - 10 * 24 * hour).toISOString(),
    updatedAt: new Date(now - ageHours * hour).toISOString(), publication,
    sourceUpdatedAt: new Date(now - hour).toISOString(), sourceStale: false, records: [],
  }
  const requests = []
  const miniflare = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundledWorker, compatibilityDate,
    bindings: { FRESHNESS_HEALTHCHECK_URL: secret },
    outboundService: async (request) => {
      const url = new URL(request.url)
      requests.push({ url: request.url, method: request.method, body: await request.text() })
      if (url.origin === 'https://johnazani.github.io' && url.pathname === '/Match_predictor/data/track-record.json' && request.method === 'GET') {
        return new Response(JSON.stringify(ledger), { headers: { 'content-type': 'application/json' } })
      }
      if (request.url === pingUrl && request.method === 'POST') return new Response(pingBody, { status: pingStatus })
      throw new Error('Unexpected outbound request')
    },
  }))
  try {
    const worker = await miniflare.getWorker()
    const result = await worker.scheduled({ cron })
    return { result, requests }
  } finally {
    await miniflare.dispose()
  }
}

describe('Cloudflare Worker runtime', () => {
  it('starts and signals only after retrieving a fresh public ledger', async () => {
    const { result, requests } = await runScheduled()
    expect(result.outcome).toBe('ok')
    expect(requests).toHaveLength(2)
    expect(new URL(requests[0].url).searchParams.has('watchdog')).toBe(true)
    expect(requests[0].method).toBe('GET')
    expect(requests[1]).toEqual({ url: pingUrl, method: 'POST', body: '' })
  })

  it.each([
    ['stale', { ageHours: 37 }],
    ['future', { ageHours: -1 }],
    ['unpublished', { publication: 'local-preview' }],
  ])('fails without pinging when the ledger is %s', async (_name, input) => {
    const { result, requests } = await runScheduled(input)
    expect(result.outcome).not.toBe('ok')
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0].url).hostname).toBe('johnazani.github.io')
  })

  it.each([{ pingStatus: 503 }, { pingBody: 'OK (not found)' }])('fails rather than claiming success after the ping retries fail', async (pingFailure) => {
    const { result, requests } = await runScheduled(pingFailure)
    expect(result.outcome).not.toBe('ok')
    expect(requests.map((request) => new URL(request.url).hostname)).toEqual(['johnazani.github.io', 'hc-ping.com', 'hc-ping.com'])
  })

  it('does not make requests if the secret is not configured', async () => {
    const { result, requests } = await runScheduled({ secret: '' })
    expect(result.outcome).not.toBe('ok')
    expect(requests).toEqual([])
  })
})
