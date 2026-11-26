// Publishes the next matchday ticket. Run inside the build job, right after the
// snapshot is generated, so the ticket it writes is part of the deployed site
// and of the Telegram message. The file is committed afterwards by a separate
// job, which is what makes the timestamp real.
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { planTicket } from '../src/lib/ticketPlan.js'

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

async function setOutput(values) {
  const output = process.env.GITHUB_OUTPUT
  if (!output) return
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')
  await appendFile(output, `${lines}\n`)
}

async function main() {
  const feedPath = resolve(process.env.MATCHDAY_PATH ?? 'public/data/matchday.json')
  const ledgerPath = resolve('picks/tickets.json')
  const feed = await readJson(feedPath)
  const ledger = await readJson(ledgerPath)
  const tickets = Array.isArray(ledger.tickets) ? ledger.tickets : []

  const ticket = planTicket({ fixtures: feed.fixtures ?? [], tickets })
  if (!ticket) {
    console.log('Every upcoming matchday already has a ticket; nothing was written.')
    await setOutput({ created: 'false', ticket_id: '' })
    return
  }

  // Never rewrite an existing date, and never change a ticket once it is in.
  if (tickets.some((existing) => existing.id === ticket.id)) {
    console.log(`Ticket ${ticket.id} is already published; nothing was written.`)
    await setOutput({ created: 'false', ticket_id: ticket.id })
    return
  }

  ledger.tickets = [...tickets, ticket]
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`)
  const legs = ticket.selections.length
  const multiples = ticket.multiples?.length ?? 0
  console.log(`Wrote ticket ${ticket.id}: ${legs} selection${legs === 1 ? '' : 's'}, ${multiples} multiple${multiples === 1 ? '' : 's'}.`)
  for (const selection of ticket.selections) {
    console.log(`  ${selection.label} (${(selection.probability * 100).toFixed(1)}%, needs ${selection.requiredPrice.toFixed(2)})`)
  }
  await setOutput({ created: 'true', ticket_id: ticket.id })
}

main().catch((error) => {
  console.error(`::error::Could not plan the next ticket: ${error.message}`)
  process.exitCode = 1
})
