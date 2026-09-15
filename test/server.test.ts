import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createCivilTimeServer } from '../src/server.ts'

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createCivilTimeServer()
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address() as AddressInfo
  try {
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  }
}

function get(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    request(url, { method: 'GET' }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) })
      })
    })
      .on('error', reject)
      .end()
  })
}

test('GET /convert returns a valid conversion', async () => {
  await withServer(async (base) => {
    const { status, body } = await get(`${base}/convert?from=America/New_York&to=Europe/London&at=2024-07-04T09:00`)
    assert.equal(status, 200)
    assert.equal(body.kind, 'valid')
    const result = body.result as Record<string, unknown>
    assert.equal(result.civil, '2024-07-04T14:00:00')
    assert.equal(result.zone, 'Europe/London')
    assert.equal(result.offset, '+01:00')
  })
})

test('GET /convert reports an ambiguous fall-back overlap', async () => {
  await withServer(async (base) => {
    const { status, body } = await get(`${base}/convert?from=America/New_York&to=Europe/London&at=2024-11-03T01:30`)
    assert.equal(status, 200)
    assert.equal(body.kind, 'ambiguous')
    assert.equal((body.earlier as Record<string, unknown>).civil, '2024-11-03T05:30:00')
    assert.equal((body.later as Record<string, unknown>).civil, '2024-11-03T06:30:00')
  })
})

test('GET /convert reports a spring-forward gap', async () => {
  await withServer(async (base) => {
    const { status, body } = await get(`${base}/convert?from=America/New_York&to=Europe/London&at=2024-03-10T02:30`)
    assert.equal(status, 200)
    assert.equal(body.kind, 'gap')
    assert.ok(body.usingEarlierOffset)
    assert.ok(body.usingLaterOffset)
  })
})

test('GET /convert rejects a missing parameter', async () => {
  await withServer(async (base) => {
    const { status, body } = await get(`${base}/convert?from=America/New_York&at=2024-07-04T09:00`)
    assert.equal(status, 400)
    assert.match(body.error as string, /required/)
  })
})

test('GET /convert rejects an unknown time zone', async () => {
  await withServer(async (base) => {
    const { status, body } = await get(`${base}/convert?from=Nowhere/Fake&to=Europe/London&at=2024-07-04T09:00`)
    assert.equal(status, 400)
    assert.match(body.error as string, /unknown IANA time zone/)
  })
})

test('GET /convert rejects an unparseable civil time', async () => {
  await withServer(async (base) => {
    const { status, body } = await get(`${base}/convert?from=America/New_York&to=Europe/London&at=not-a-date`)
    assert.equal(status, 400)
    assert.match(body.error as string, /could not parse/)
  })
})

test('GET /zones lists known zones as JSON', async () => {
  await withServer(async (base) => {
    const { status, body } = await get(`${base}/zones`)
    assert.equal(status, 200)
    const zones = body.zones as string[]
    assert.ok(Array.isArray(zones))
    assert.ok(zones.includes('America/New_York'))
  })
})

test('unsupported methods return 405', async () => {
  await withServer(async (base) => {
    const { status, body } = await new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      request(`${base}/zones`, { method: 'POST' }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
      })
        .on('error', reject)
        .end()
    })
    assert.equal(status, 405)
    assert.match(body.error as string, /not supported/)
  })
})

test('unknown routes return 404', async () => {
  await withServer(async (base) => {
    const { status, body } = await get(`${base}/nope`)
    assert.equal(status, 404)
    assert.match(body.error as string, /no route/)
  })
})
