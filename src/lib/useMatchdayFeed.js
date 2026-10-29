import { useCallback, useEffect, useState } from 'react'
import { fixtures as demoFixtures } from '../data/fixtures.js'

const loading = { status: 'loading', fixtures: [], source: null, backtest: null }
const fallback = { status: 'demo', fixtures: demoFixtures, source: null, backtest: null }

// The Node build uses a same-origin API. GitHub Pages uses a bundled snapshot
// and, if needed, fetches the public community data directly in the browser.
export function useMatchdayFeed() {
  const [feed, setFeed] = useState(loading)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((current) => current + 1), [])

  useEffect(() => {
    const timer = window.setInterval(() => setAttempt((current) => current + 1), 30 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setFeed((current) => current.status === 'loading' ? loading : { ...current, refreshing: true })
    async function load() {
      const useData = (data) => {
        if (!controller.signal.aborted) setFeed({ status: 'community', fixtures: data.fixtures, source: data.source, backtest: data.backtest ?? null })
      }
      try {
        let data
        if (import.meta.env.VITE_STATIC_FEED === 'true') {
          const { loadStaticMatchday } = await import('./staticMatchdayFeed.js')
          data = await loadStaticMatchday({ signal: controller.signal, onCached: useData })
        } else {
          const response = await fetch('/api/matchday', { signal: controller.signal })
          if (!response.ok) throw new Error('Feed unavailable')
          data = await response.json()
        }
        if (data.mode !== 'community' || !Array.isArray(data.fixtures) || !data.source) throw new Error('Unexpected feed response')
        useData(data)
      } catch (error) {
        if (!controller.signal.aborted && error.name !== 'AbortError') {
          setFeed((current) => current.status === 'community'
            ? { ...current, refreshing: false, source: { ...current.source, stale: true, refreshFailed: true } }
            : fallback)
        }
      }
    }
    load()
    return () => controller.abort()
  }, [attempt])

  return { ...feed, retry }
}
