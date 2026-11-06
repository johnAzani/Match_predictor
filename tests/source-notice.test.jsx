import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SourceNotice } from '../src/App.jsx'

const source = (overrides = {}) => ({
  name: 'open-matchday',
  url: 'https://github.com/oladeeayo/open-matchday',
  sourceUpdatedAt: '2026-11-05T06:00:00.000Z',
  fetchedAt: '2026-11-05T07:00:00.000Z',
  stale: false,
  refreshFailed: false,
  unavailableLeagues: [],
  ...overrides,
})

const feed = (sourceOverrides = {}) => ({ status: 'community', source: source(sourceOverrides), retry: () => {}, refreshing: false })

describe('source notice', () => {
  it('keeps the community wording when no credit is supplied', () => {
    render(<SourceNotice feed={feed()} onOpenMethod={() => {}} />)
    expect(screen.getByText('COMMUNITY DATA · NON-COMMERCIAL')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /football data by/i })).not.toBeInTheDocument()
  })

  it('shows the required linked credit for a licensed feed', () => {
    render(<SourceNotice
      feed={feed({ name: 'five-dollar-football', attribution: { text: 'Football data by 5DollarFootballAPI', url: 'https://5dollarfootballapi.com/' } })}
      onOpenMethod={() => {}}
    />)
    expect(screen.getByText('PARTNER FEED')).toBeInTheDocument()
    const credit = screen.getByRole('link', { name: 'Football data by 5DollarFootballAPI' })
    expect(credit).toHaveAttribute('href', 'https://5dollarfootballapi.com/')
    expect(screen.queryByText('COMMUNITY DATA · NON-COMMERCIAL')).not.toBeInTheDocument()
  })

  it('still warns about staleness and keeps the credit attached', () => {
    render(<SourceNotice
      feed={feed({ name: 'five-dollar-football', stale: true, attribution: { text: 'Football data by 5DollarFootballAPI', url: 'https://5dollarfootballapi.com/' } })}
      onOpenMethod={() => {}}
    />)
    expect(screen.getByText('DATA MAY BE STALE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Football data by 5DollarFootballAPI' })).toBeInTheDocument()
  })

  it('never claims non-commercial community data is stale-licensed', () => {
    render(<SourceNotice feed={feed({ stale: true })} onOpenMethod={() => {}} />)
    expect(screen.getByText('DATA MAY BE STALE · NON-COMMERCIAL')).toBeInTheDocument()
  })
})
