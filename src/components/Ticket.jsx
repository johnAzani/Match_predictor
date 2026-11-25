import { useMemo } from 'react'
import { ReceiptText } from 'lucide-react'
import ticketData from '../../picks/tickets.json'
import { MARKET_LABELS, summarizeTickets } from '../lib/ticket.js'

const percent = (value) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`)
const price = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—')

const STATUS_LABELS = Object.freeze({
  won: 'WON',
  lost: 'LOST',
  push: 'PUSH',
  pending: 'PENDING',
  unrecorded: 'AWAITING LEDGER',
})

function shortDate(value) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`))
}

export default function Ticket({ tracker, tickets = ticketData.tickets }) {
  const summary = useMemo(
    () => summarizeTickets(tickets, tracker?.records ?? []),
    [tickets, tracker],
  )
  const published = tracker?.publication === 'github-pages'
  const hasTickets = summary.tickets.length > 0

  return (
    <section className="ticket" id="ticket" aria-labelledby="ticket-title">
      <div className="ticket__heading">
        <div>
          <div className="performance__kicker"><ReceiptText size={15} aria-hidden="true" /> THE TICKET</div>
          <h3 id="ticket-title">MY SELECTIONS<span aria-hidden="true">.</span></h3>
          <p>The games picked here in advance, written into the repository before kick-off and settled afterwards against the same public ledger. Nothing is added, edited or removed once a match has been played.</p>
        </div>
        <div className="ticket__score">
          <strong aria-label={`${summary.won} won, ${summary.lost} lost`}>{summary.won}<span>–</span>{summary.lost}</strong>
          <small>{summary.decided ? `${percent(summary.hitRate)} of decided selections` : 'No settled selections yet'}</small>
          {summary.pending + summary.unrecorded > 0 && <em>{summary.pending + summary.unrecorded} still to settle</em>}
        </div>
      </div>

      {!hasTickets ? (
        <div className="performance__empty">
          <strong>NO TICKET YET</strong>
          <p>The first ticket will be published here before its matches kick off.</p>
        </div>
      ) : summary.tickets.map((ticket) => (
        <div className="ticket__sheet" key={ticket.id}>
          <div className="ticket__sheet-head">
            <div><span>TICKET {ticket.id}</span><strong>{ticket.label}</strong></div>
            <small>{ticket.selections.length} independent singles · never multiplied</small>
          </div>
          <table className="calibration-table ticket__table">
            <caption className="sr-only">Selections in ticket {ticket.id} with their model probability, the price needed and the settled outcome</caption>
            <thead><tr><th scope="col">Match</th><th scope="col">Selection</th><th scope="col">Model</th><th scope="col">Needs</th><th scope="col">Result</th></tr></thead>
            <tbody>{ticket.selections.map((selection) => (
              <tr key={selection.id} className={`is-${selection.state}`}>
                <th scope="row">{selection.home} <span>v</span> {selection.away}<small>{shortDate(selection.date)} · {selection.league}</small></th>
                <td>{selection.label}<small>{MARKET_LABELS[selection.market] ?? selection.market}</small></td>
                <td>{percent(selection.probability)}<small>fair {price(selection.fairOdds)}</small></td>
                <td>{price(selection.requiredPrice)}+</td>
                <td>
                  <span className={`ticket__chip is-${selection.state}`}>{STATUS_LABELS[selection.state] ?? selection.state}</span>
                  {selection.score && <small>{selection.score}</small>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {ticket.note && <p className="ticket__note">{ticket.note}</p>}
        </div>
      ))}

      <p className="ticket__footnote">
        Selections are committed to <code>picks/tickets.json</code> before kick-off, so the commit history is the timestamp. Each one is scored as a single against the public ledger: a draw wins <strong>+0.5</strong>, a one-goal defeat returns the stake on <strong>+1</strong>, and a push is not counted as a win. No odds are supplied — “needs” is the fair price implied by the model probability, and a price below it is a losing bet even when the selection wins. {published ? '' : 'Local previews are not scored.'}
      </p>
    </section>
  )
}
