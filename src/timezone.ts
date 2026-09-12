// Core question this module answers: given a civil (wall-clock) date-time in
// one IANA time zone, what is the equivalent civil date-time in another zone?
//
// The hard part isn't the arithmetic, it's that a civil date-time doesn't map
// to a single instant near a DST transition:
//   - spring-forward creates a gap: some wall-clock times never happen.
//   - fall-back creates an overlap: some wall-clock times happen twice.
// This module resolves that ambiguity explicitly instead of silently picking
// one answer, using the IANA tz data that ships with Node's ICU build via
// Intl, so there is no separate tz database dependency to maintain.

export interface CivilDateTime {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
}

export type WallClockResolution =
  | { kind: 'valid'; instant: number }
  | { kind: 'ambiguous'; earlier: number; later: number }
  | { kind: 'gap'; usingEarlierOffset: number; usingLaterOffset: number }

export type ZoneConversion =
  | { kind: 'valid'; instant: number; target: CivilDateTime }
  | {
      kind: 'ambiguous'
      earlier: number
      later: number
      targetEarlier: CivilDateTime
      targetLater: CivilDateTime
    }
  | {
      kind: 'gap'
      usingEarlierOffset: number
      usingLaterOffset: number
      targetUsingEarlierOffset: CivilDateTime
      targetUsingLaterOffset: CivilDateTime
    }

const DAY_MS = 24 * 60 * 60 * 1000

// Built once per process; the set of supported zones doesn't change at runtime.
const KNOWN_TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'))

export function isValidTimeZone(timeZone: string): boolean {
  return KNOWN_TIME_ZONES.has(timeZone)
}

/** All IANA zone names this runtime knows about, sorted for stable output. */
export function listSupportedTimeZones(): string[] {
  return [...KNOWN_TIME_ZONES].sort()
}

function assertValidTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`unknown IANA time zone "${timeZone}"`)
  }
}

/** Reads the civil date-time that a given instant displays as in `timeZone`. */
export function civilTimeInZone(epochMillis: number, timeZone: string): CivilDateTime {
  assertValidTimeZone(timeZone)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(epochMillis))
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type)
    if (!part) throw new Error(`missing "${type}" field for time zone "${timeZone}"`)
    return Number(part.value)
  }
  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: field('hour'),
    minute: field('minute'),
    second: field('second'),
  }
}

/** UTC offset, in minutes, in effect for `timeZone` at the given instant. */
export function offsetMinutesAt(epochMillis: number, timeZone: string): number {
  const f = civilTimeInZone(epochMillis, timeZone)
  const asIfUTC = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second)
  return Math.round((asIfUTC - epochMillis) / 60_000)
}

function civilEquals(a: CivilDateTime, b: CivilDateTime): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  )
}

/**
 * Finds every distinct UTC offset `timeZone` is on between `low` and `high`,
 * in chronological order, by bisecting down to one-second resolution.
 *
 * A single DST transition yields two offsets, which is all a plain
 * before/after probe needs. A handful of zones have changed their base
 * offset and their DST rule within the same day (e.g. a country moving to a
 * new standard time right as it also ends daylight saving) which produces a
 * third offset in between that a before/after probe would never see.
 */
function findTransitionOffsets(low: number, high: number, timeZone: string): number[] {
  const offsetLow = offsetMinutesAt(low, timeZone)
  const offsetHigh = offsetMinutesAt(high, timeZone)

  if (offsetLow === offsetHigh) return [offsetLow]
  if (high - low <= 1000) return [offsetLow, offsetHigh]

  const mid = low + Math.floor((high - low) / 2)
  const left = findTransitionOffsets(low, mid, timeZone)
  const right = findTransitionOffsets(mid, high, timeZone)
  if (left[left.length - 1] === right[0]) right.shift()
  return left.concat(right)
}

/**
 * Resolves a civil date-time in `timeZone` to the instant(s) it refers to.
 *
 * The approach: collect every offset `timeZone` uses in the day before and
 * the day after the naive timestamp. One offset means no nearby transition,
 * so the answer is unambiguous. More than one means build a candidate
 * instant from each distinct offset and check which candidate(s) actually
 * format back to the requested civil time. Zero matches means the time was
 * skipped (gap); two means it happened twice (ambiguous, fall-back
 * overlap). Zones with a double transition close together surface a third
 * offset here that a simple before/after probe would miss, which matters
 * when that middle offset turns out to be the one that actually round-trips.
 */
export function resolveCivilTime(civil: CivilDateTime, timeZone: string): WallClockResolution {
  const naiveUtc = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second)

  const offsets = findTransitionOffsets(naiveUtc - DAY_MS, naiveUtc + DAY_MS, timeZone)

  if (offsets.length === 1) {
    return { kind: 'valid', instant: naiveUtc - offsets[0] * 60_000 }
  }

  const candidates: number[] = []
  for (const offsetMinutes of offsets) {
    const instant = naiveUtc - offsetMinutes * 60_000
    if (!candidates.includes(instant)) candidates.push(instant)
  }

  const matches = candidates.filter((instant) => civilEquals(civilTimeInZone(instant, timeZone), civil))

  if (matches.length === 0) {
    // None of the offsets in play round-trip: the requested civil time was
    // skipped entirely. Report the bracketing interpretations rather than
    // guessing one.
    return { kind: 'gap', usingEarlierOffset: candidates[0], usingLaterOffset: candidates[candidates.length - 1] }
  }

  if (matches.length === 1) {
    return { kind: 'valid', instant: matches[0] }
  }

  // More than two matches would mean the same civil time round-trips under
  // three or more distinct offsets, which no zone in the current tz
  // database does. Collapse to the outer bracket rather than growing the
  // public type for a case that can't currently happen.
  const sorted = [...matches].sort((a, b) => a - b)
  return { kind: 'ambiguous', earlier: sorted[0], later: sorted[sorted.length - 1] }
}

export function convert(civil: CivilDateTime, fromZone: string, toZone: string): ZoneConversion {
  const resolution = resolveCivilTime(civil, fromZone)

  switch (resolution.kind) {
    case 'valid':
      return { kind: 'valid', instant: resolution.instant, target: civilTimeInZone(resolution.instant, toZone) }
    case 'ambiguous':
      return {
        kind: 'ambiguous',
        earlier: resolution.earlier,
        later: resolution.later,
        targetEarlier: civilTimeInZone(resolution.earlier, toZone),
        targetLater: civilTimeInZone(resolution.later, toZone),
      }
    case 'gap':
      return {
        kind: 'gap',
        usingEarlierOffset: resolution.usingEarlierOffset,
        usingLaterOffset: resolution.usingLaterOffset,
        targetUsingEarlierOffset: civilTimeInZone(resolution.usingEarlierOffset, toZone),
        targetUsingLaterOffset: civilTimeInZone(resolution.usingLaterOffset, toZone),
      }
  }
}

export function formatOffset(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? '-' : '+'
  const abs = Math.abs(totalMinutes)
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function formatCivil(c: CivilDateTime): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${c.year}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}`
}
