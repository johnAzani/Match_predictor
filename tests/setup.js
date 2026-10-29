import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
window.requestAnimationFrame = (callback) => { callback(); return 1 }

beforeEach(() => {
  // UI tests start offline unless a test explicitly supplies a community feed.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline in test')))
})
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})
