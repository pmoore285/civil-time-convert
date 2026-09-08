import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  convert,
  formatOffset,
  isValidTimeZone,
  listSupportedTimeZones,
  offsetMinutesAt,
  resolveCivilTime,
  type CivilDateTime,
} from '../src/timezone.ts'

function civil(year: number, month: number, day: number, hour: number, minute: number, second = 0): CivilDateTime {
  return { year, month, day, hour, minute, second }
}

// Straightforward conversions: no DST transition anywhere near the input,
// so there should be exactly one answer.
const VALID_CASES: Array<{
  name: string
  input: CivilDateTime
  from: string
  to: string
  expected: CivilDateTime
}> = [
  {
    name: 'two fixed-offset zones, one with a 30 minute component (Kolkata -> Kiritimati)',
    input: civil(2024, 6, 15, 12, 0),
    from: 'Asia/Kolkata',
    to: 'Pacific/Kiritimati',
    expected: civil(2024, 6, 15, 20, 30),
  },
  {
    name: 'both zones observing daylight saving (New York EDT -> London BST)',
    input: civil(2024, 7, 4, 9, 0),
    from: 'America/New_York',
    to: 'Europe/London',
    expected: civil(2024, 7, 4, 14, 0),
  },
  {
    name: 'both zones on standard time (New York EST -> London GMT)',
    input: civil(2024, 1, 15, 9, 0),
    from: 'America/New_York',
    to: 'Europe/London',
    expected: civil(2024, 1, 15, 14, 0),
  },
  {
    name: 'same zone on both ends is the identity',
    input: civil(2024, 5, 1, 8, 15),
    from: 'Europe/Paris',
    to: 'Europe/Paris',
    expected: civil(2024, 5, 1, 8, 15),
  },
]

for (const testCase of VALID_CASES) {
  test(`convert: ${testCase.name}`, () => {
    const result = convert(testCase.input, testCase.from, testCase.to)
    assert.equal(result.kind, 'valid')
    if (result.kind === 'valid') {
      assert.deepEqual(result.target, testCase.expected)
    }
  })
}

test('resolveCivilTime: spring-forward gap in America/New_York reports both candidate offsets', () => {
  const result = resolveCivilTime(civil(2024, 3, 10, 2, 30), 'America/New_York')
  assert.equal(result.kind, 'gap')
  if (result.kind !== 'gap') return
  assert.equal(result.usingEarlierOffset, Date.UTC(2024, 2, 10, 7, 30, 0))
  assert.equal(result.usingLaterOffset, Date.UTC(2024, 2, 10, 6, 30, 0))
})

test('resolveCivilTime: fall-back overlap in America/New_York reports both instants', () => {
  const result = resolveCivilTime(civil(2024, 11, 3, 1, 30), 'America/New_York')
  assert.equal(result.kind, 'ambiguous')
  if (result.kind !== 'ambiguous') return
  assert.equal(result.earlier, Date.UTC(2024, 10, 3, 5, 30, 0))
  assert.equal(result.later, Date.UTC(2024, 10, 3, 6, 30, 0))
})

test('resolveCivilTime: Sydney falls back in April, opposite hemisphere and season from New York', () => {
  const result = resolveCivilTime(civil(2024, 4, 7, 2, 30), 'Australia/Sydney')
  assert.equal(result.kind, 'ambiguous')
  if (result.kind !== 'ambiguous') return
  assert.equal(result.earlier, Date.UTC(2024, 3, 6, 15, 30, 0))
  assert.equal(result.later, Date.UTC(2024, 3, 6, 16, 30, 0))
})

test('resolveCivilTime: Sydney springs forward in October', () => {
  const result = resolveCivilTime(civil(2024, 10, 6, 2, 30), 'Australia/Sydney')
  assert.equal(result.kind, 'gap')
  if (result.kind !== 'gap') return
  assert.equal(result.usingEarlierOffset, Date.UTC(2024, 9, 5, 16, 30, 0))
  assert.equal(result.usingLaterOffset, Date.UTC(2024, 9, 5, 15, 30, 0))
})

test('isValidTimeZone: recognizes real IANA names and rejects made-up or legacy ones', () => {
  assert.equal(isValidTimeZone('America/New_York'), true)
  assert.equal(isValidTimeZone('Europe/London'), true)
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false)
  assert.equal(isValidTimeZone('EST'), false)
})

test('listSupportedTimeZones: includes known zones, sorted, with no duplicates', () => {
  const zones = listSupportedTimeZones()
  assert.ok(zones.includes('America/New_York'))
  assert.ok(zones.includes('Europe/London'))
  assert.deepEqual(zones, [...zones].sort())
  assert.equal(new Set(zones).size, zones.length)
})

test('convert: throws a clear error for an unknown "from" zone instead of an Intl internal error', () => {
  assert.throws(
    () => convert(civil(2024, 6, 15, 12, 0), 'Nowhere/Fake', 'Europe/London'),
    /unknown IANA time zone "Nowhere\/Fake"/,
  )
})

test('convert: throws a clear error for an unknown "to" zone', () => {
  assert.throws(
    () => convert(civil(2024, 6, 15, 12, 0), 'Europe/London', 'Nowhere/Fake'),
    /unknown IANA time zone "Nowhere\/Fake"/,
  )
})

test('formatOffset: renders positive, negative, zero, and half-hour offsets', () => {
  assert.equal(formatOffset(0), '+00:00')
  assert.equal(formatOffset(330), '+05:30')
  assert.equal(formatOffset(-300), '-05:00')
  assert.equal(formatOffset(-570), '-09:30')
  assert.equal(formatOffset(60), '+01:00')
})

test('offsetMinutesAt: matches known standard and daylight offsets', () => {
  assert.equal(offsetMinutesAt(Date.UTC(2024, 0, 15, 12, 0, 0), 'America/New_York'), -300)
  assert.equal(offsetMinutesAt(Date.UTC(2024, 6, 15, 12, 0, 0), 'America/New_York'), -240)
  assert.equal(offsetMinutesAt(Date.UTC(2024, 6, 15, 12, 0, 0), 'Asia/Kolkata'), 330)
  assert.equal(offsetMinutesAt(Date.UTC(2024, 6, 15, 12, 0, 0), 'Europe/London'), 60)
})

test('resolveCivilTime: the seconds right at the edges of the New York gap are still valid', () => {
  const justBefore = resolveCivilTime(civil(2024, 3, 10, 1, 59, 59), 'America/New_York')
  const justAfter = resolveCivilTime(civil(2024, 3, 10, 3, 0, 0), 'America/New_York')
  assert.equal(justBefore.kind, 'valid')
  assert.equal(justAfter.kind, 'valid')
  if (justBefore.kind !== 'valid' || justAfter.kind !== 'valid') return
  assert.equal(justBefore.instant, Date.UTC(2024, 2, 10, 6, 59, 59))
  assert.equal(justAfter.instant, Date.UTC(2024, 2, 10, 7, 0, 0))
})
