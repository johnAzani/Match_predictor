import { describe, expect, it, vi } from 'vitest'
import { loadStaticMatchday, prepareStaticFeed } from '../src/lib/staticMatchdayFeed.js'

const now = Date.parse('2026-10-29T12:00:00Z')
const hour = 60 * 60 * 1000
const fixture = (id, timestamp) => ({ id, day: 'THU 29 OCT', time: '15:00', kickoffTimestamp: timestamp, league: { id: 'test', name: 'Test league' }, home: { name: 'Home', shortName: 'Home', form: [] }, away: { name: 'Away', shortName: 'Away', form: [] } })
const feed = (fetchedAt, updatedAt = fetchedAt) => ({
  mode: 'community',
  fixtures: [fixture('past', now - hour), fixture('future', now + hour)],
  source: { fetchedAt: new Date(fetchedAt).toISOString(), sourceUpdatedAt: new Date(updatedAt).toISOString(), stale: false, refreshFailed: false, availableLeagueCount: 1 },
  backtest: { evaluated: 10, accuracy: 0.5, baselineAccuracy: 0.4, brier: 0.6, logLoss: 1.0, skipped: 2 },
})
const response = (data) => ({ ok: true, json: async () => data })
const memoryStorage = (value = null) => {
  let current = value ? JSON.stringify(value) : null
  return { getItem: vi.fn(() => current), setItem: vi.fn((_key, value) => { current = value }), value: () => current && JSON.parse(current) }
}

describe('GitHub Pages static data', () => {
  it('uses the bundled snapshot, removes elapsed kickoffs and avoids unnecessary API calls', async () => {
    const data = feed(now - hour)
    const fetchImpl = vi.fn(async () => response(data))
    const serviceFactory = vi.fn()
    const loaded = await loadStaticMatchday({ fetchImpl, serviceFactory, storage: memoryStorage(), now, url: '/repo/data/matchday.json' })
    expect(fetchImpl).toHaveBeenCalledWith('/repo/data/matchday.json', expect.objectContaining({ cache: 'no-store' }))
    expect(serviceFactory).not.toHaveBeenCalled()
    expect(loaded.fixtures.map((item) => item.id)).toEqual(['future'])
    expect(loaded.source.delivery).toBe('github-pages')
    expect(loaded.source.stale).toBe(false)
  })

  it('prefers a newer cached snapshot over an older deployment', async () => {
    const cache = memoryStorage(feed(now - hour))
    const serviceFactory = vi.fn()
    const onCached = vi.fn()
    const loaded = await loadStaticMatchday({ fetchImpl: vi.fn(async () => response(feed(now - 2 * hour))), serviceFactory, storage: cache, now, onCached })
    expect(loaded.source.fetchedAt).toBe(new Date(now - hour).toISOString())
    expect(serviceFactory).not.toHaveBeenCalled()
    expect(onCached).toHaveBeenCalled()
  })

  it('refreshes an older snapshot from the community provider and saves it locally', async () => {
    const cache = memoryStorage()
    const getMatchday = vi.fn(async () => feed(now))
    const serviceFactory = vi.fn(() => ({ getMatchday }))
    const onCached = vi.fn()
    const loaded = await loadStaticMatchday({ fetchImpl: vi.fn(async () => response(feed(now - 25 * hour))), serviceFactory, storage: cache, now, onCached })
    expect(onCached).toHaveBeenCalled()
    expect(getMatchday).toHaveBeenCalledOnce()
    expect(cache.value().source.fetchedAt).toBe(new Date(now).toISOString())
    expect(loaded.source.stale).toBe(false)
  })

  it('keeps an old snapshot with an explicit stale warning if refresh fails', async () => {
    const serviceFactory = () => ({ getMatchday: vi.fn().mockRejectedValue(new Error('quota')) })
    const loaded = await loadStaticMatchday({ fetchImpl: vi.fn(async () => response(feed(now - 49 * hour))), serviceFactory, storage: memoryStorage(), now })
    expect(loaded.fixtures.map((item) => item.id)).toEqual(['future'])
    expect(loaded.source.stale).toBe(true)
    expect(loaded.source.refreshFailed).toBe(true)
    expect(prepareStaticFeed(feed(now - hour, now - 49 * hour), now).source.stale).toBe(true)
  })

  it('ignores corrupt cached data instead of trying to render it', async () => {
    const corrupt = feed(now - hour)
    corrupt.fixtures[1].home.shortName = null
    const loaded = await loadStaticMatchday({ fetchImpl: vi.fn(async () => response(feed(now - 2 * hour))), serviceFactory: vi.fn(), storage: memoryStorage(corrupt), now })
    expect(loaded.source.fetchedAt).toBe(new Date(now - 2 * hour).toISOString())
  })

  it('falls back to cache when the deployed snapshot is unavailable', async () => {
    const cache = memoryStorage(feed(now - hour))
    const loaded = await loadStaticMatchday({ fetchImpl: vi.fn().mockRejectedValue(new Error('offline')), serviceFactory: vi.fn(), storage: cache, now })
    expect(loaded.source.fetchedAt).toBe(new Date(now - hour).toISOString())
    expect(loaded.source.stale).toBe(false)
  })

  it('fails cleanly without any usable snapshot and propagates cancellation', async () => {
    const serviceFactory = () => ({ getMatchday: vi.fn().mockRejectedValue(new Error('offline')) })
    await expect(loadStaticMatchday({ fetchImpl: vi.fn().mockRejectedValue(new Error('offline')), serviceFactory, storage: memoryStorage(), now })).rejects.toThrow('offline')
    const controller = new AbortController()
    controller.abort()
    await expect(loadStaticMatchday({ fetchImpl: vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')), serviceFactory, storage: memoryStorage(), now, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
