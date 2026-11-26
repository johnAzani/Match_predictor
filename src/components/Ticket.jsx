import { useMemo } from 'react'
import { ReceiptText } from 'lucide-react'
import ticketData from '../../picks/tickets.json'
import { MARKET_LABELS, legName, summarizeTickets } from '../lib/ticket.js'

const percent = (value) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`)
const price = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—')

// Daily tickets would otherwise turn the panel into a scroll of old slips; the
// score above always covers every ticket, whatever is listed here.
const RECENT_LIMIT = 6

const STATUS_LABELS = Object.freeze({
  won: 'WON',
  lost: 'LOST',
  push: 'PUSH',
  pending: 'PENDING',
  unrecorded: 'AWAITING LEDGER',
  invalid: 'REFUSED',
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
      ) : summary.tickets.slice(0, RECENT_LIMIT).map((ticket) => (
        <div className="ticket__sheet" key={ticket.id}>
          <div className="ticket__sheet-head">
            <div><span>TICKET {ticket.id}</span><strong>{ticket.label}</strong></div>
            <small>{ticket.selections.length} single{ticket.selections.length === 1 ? '' : 's'} scored one by one{ticket.multiples.length ? ` · ${ticket.multiples.length} multiple${ticket.multiples.length === 1 ? '' : 's'} below` : ''}</small>
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
          {ticket.multiples.length > 0 && (
            <div className="ticket__multiples">
              <div className="ticket__multiples-head">
                <strong>MULTIPLES</strong>
                <small>the same singles combined into one slip · every leg from a different match</small>
              </div>
              <ul>
                {ticket.multiples.map((multiple) => (
                  <li key={multiple.id} className={`is-${multiple.state}`}>
                    <div className="ticket__multiples-legs">
                      <strong>{multiple.label}</strong>
                      <small>
                        {multiple.legs.length} legs · {multiple.legs.map(legName).join(' + ')}
                        {multiple.state === 'invalid' && multiple.note ? ` · ${multiple.note}` : ''}
                        {multiple.voids ? ` · ${multiple.voids} voided` : ''}
                      </small>
                    </div>
                    <div className="ticket__multiples-price">
                      <span>{percent(multiple.probability)}</span>
                      <small>{multiple.requiredPrice === null ? 'no price' : `min ${price(multiple.requiredPrice)}`}</small>
                    </div>
                    <span className={`ticket__chip is-${multiple.state}`}>{STATUS_LABELS[multiple.state] ?? multiple.state}</span>
                  </li>
                ))}
              </ul>
              <p className="ticket__note">
                A multiple wins only if every leg wins, so the chance is the product of the legs above — which is why it
                shrinks leg by leg while the price grows. It is only worth taking at or above the price shown; below that
                it loses money over time even when it wins. Legs are always from different matches: two markets on one
                fixture are related bets, so they are refused rather than multiplied, and a leg that pushes drops out and
                leaves the price of the remaining legs.
              </p>
            </div>
          )}
          {ticket.note && <p className="ticket__note">{ticket.note}</p>}
        </div>
      ))}

      {summary.tickets.length > RECENT_LIMIT && (
        <p className="ticket__note">
          Showing the {RECENT_LIMIT} most recent of {summary.tickets.length} tickets. The score above and the
          hit rate cover every ticket in the ledger.
        </p>
      )}

      <p className="ticket__footnote">
        Selections are committed to <code>picks/tickets.json</code> before kick-off, so the commit history is the timestamp. Each one is scored as a single against the public ledger, and its multiples are settled from those same legs: a draw wins <strong>+0.5</strong>, a one-goal defeat returns the stake on <strong>+1</strong>, and a push is not counted as a win. No odds are supplied — “needs” is the fair price implied by the model probability, and a price below it is a losing bet even when the selection wins. {published ? '' : 'Local previews are not scored.'}
      </p>
    </section>
  )
}
