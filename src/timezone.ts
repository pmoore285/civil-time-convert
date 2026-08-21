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

/** Reads the civil date-time that a given instant displays as in `timeZone`. */
export function civilTimeInZone(epochMillis: number, timeZone: string): CivilDateTime {
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
function offsetMinutesAt(epochMillis: number, timeZone: string): number {
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
 * Resolves a civil date-time in `timeZone` to the instant(s) it refers to.
 *
 * The approach: read the UTC offset a day before and a day after the naive
 * timestamp. If they match, there's no nearby transition and the answer is
 * unambiguous. If they differ, build a candidate instant from each offset
 * and check which candidate(s) actually format back to the requested civil
 * time. Zero matches means the time was skipped (gap); two means it happened
 * twice (ambiguous, fall-back overlap).
 */
export function resolveCivilTime(civil: CivilDateTime, timeZone: string): WallClockResolution {
  const naiveUtc = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second)

  const offsetBefore = offsetMinutesAt(naiveUtc - DAY_MS, timeZone)
  const offsetAfter = offsetMinutesAt(naiveUtc + DAY_MS, timeZone)

  if (offsetBefore === offsetAfter) {
    return { kind: 'valid', instant: naiveUtc - offsetBefore * 60_000 }
  }

  const usingEarlierOffset = naiveUtc - offsetBefore * 60_000
  const usingLaterOffset = naiveUtc - offsetAfter * 60_000

  const earlierMatches = civilEquals(civilTimeInZone(usingEarlierOffset, timeZone), civil)
  const laterMatches = civilEquals(civilTimeInZone(usingLaterOffset, timeZone), civil)

  if (earlierMatches && laterMatches) {
    return {
      kind: 'ambiguous',
      earlier: Math.min(usingEarlierOffset, usingLaterOffset),
      later: Math.max(usingEarlierOffset, usingLaterOffset),
    }
  }

  if (earlierMatches) return { kind: 'valid', instant: usingEarlierOffset }
  if (laterMatches) return { kind: 'valid', instant: usingLaterOffset }

  // Neither candidate round-trips: the requested civil time was skipped
  // entirely. Report both nearby interpretations rather than guessing one.
  return { kind: 'gap', usingEarlierOffset, usingLaterOffset }
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
