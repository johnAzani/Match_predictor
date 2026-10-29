import { useCallback, useEffect, useState } from 'react'
import { isValidTracker } from './tracker.js'

// This is the single published ledger, not forecasts reconstructed in the
// browser. It remains separate from the historical walk-forward backtest.
export function useTrackRecord() {
  const [state, setState] = useState({ status: 'loading', data: null, loadFailed: false })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    const interval = window.setInterval(() => setAttempt((value) => value + 1), 30 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let timedOut = false
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, 15_000)
    async function load() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/track-record.json`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Track record unavailable')
        const data = await response.json()
        if (!isValidTracker(data)) throw new Error('Invalid track record')
        if (active && !timedOut) setState({ status: 'ready', data, loadFailed: false })
      } catch (error) {
        if (active && (timedOut || error.name !== 'AbortError')) {
          setState((current) => current.data ? { ...current, loadFailed: true } : { status: 'unavailable', data: null, loadFailed: true })
        }
      } finally {
        window.clearTimeout(timeout)
      }
    }
    load()
    return () => { active = false; window.clearTimeout(timeout); controller.abort() }
  }, [attempt])

  return { ...state, retry }
}
