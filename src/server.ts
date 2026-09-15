// HTTP wrapper around the conversion library for callers that aren't Node,
// or don't want to shell out to the CLI. Two routes, both GET, both JSON:
//   /convert?from=<zone>&to=<zone>&at=<YYYY-MM-DDTHH:mm[:ss]>
//   /zones

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  convert,
  formatCivil,
  formatOffset,
  isValidTimeZone,
  listSupportedTimeZones,
  offsetMinutesAt,
  parseCivilTime,
  type CivilDateTime,
} from './timezone.ts'

interface ZonedResult {
  instant: string
  civil: string
  zone: string
  offset: string
}

function describeInstant(instant: number, civilTime: CivilDateTime, zone: string): ZonedResult {
  return {
    instant: new Date(instant).toISOString(),
    civil: formatCivil(civilTime),
    zone,
    offset: formatOffset(offsetMinutesAt(instant, zone)),
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

function handleConvert(url: URL, res: ServerResponse): void {
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const at = url.searchParams.get('at')

  if (!from || !to || !at) {
    sendJson(res, 400, { error: 'query parameters "from", "to", and "at" are all required' })
    return
  }

  let civil: CivilDateTime
  try {
    civil = parseCivilTime(at)
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) })
    return
  }

  if (!isValidTimeZone(from)) {
    sendJson(res, 400, { error: `unknown IANA time zone "${from}"` })
    return
  }
  if (!isValidTimeZone(to)) {
    sendJson(res, 400, { error: `unknown IANA time zone "${to}"` })
    return
  }

  const result = convert(civil, from, to)
  const input = { civil: formatCivil(civil), zone: from }

  switch (result.kind) {
    case 'valid':
      sendJson(res, 200, { kind: 'valid', input, result: describeInstant(result.instant, result.target, to) })
      return
    case 'ambiguous':
      sendJson(res, 200, {
        kind: 'ambiguous',
        input,
        earlier: describeInstant(result.earlier, result.targetEarlier, to),
        later: describeInstant(result.later, result.targetLater, to),
      })
      return
    case 'gap':
      sendJson(res, 200, {
        kind: 'gap',
        input,
        usingEarlierOffset: describeInstant(result.usingEarlierOffset, result.targetUsingEarlierOffset, to),
        usingLaterOffset: describeInstant(result.usingLaterOffset, result.targetUsingLaterOffset, to),
      })
      return
  }
}

function handleZones(res: ServerResponse): void {
  sendJson(res, 200, { zones: listSupportedTimeZones() })
}

function requestListener(req: IncomingMessage, res: ServerResponse): void {
  if (!req.url) {
    sendJson(res, 400, { error: 'malformed request' })
    return
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: `method "${req.method}" is not supported, use GET` })
    return
  }

  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/convert') {
    handleConvert(url, res)
    return
  }
  if (url.pathname === '/zones') {
    handleZones(res)
    return
  }
  sendJson(res, 404, { error: `no route for "${url.pathname}", try /convert or /zones` })
}

export function createCivilTimeServer(): Server {
  return createServer(requestListener)
}

function main(): void {
  const port = Number(process.env.PORT ?? 8080)
  const server = createCivilTimeServer()
  server.listen(port, () => {
    console.log(`civil-time-convert listening on http://localhost:${port}`)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
