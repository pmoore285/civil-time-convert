# civil-time-convert

Answers one question: if it's a given wall-clock time in one IANA time
zone, what wall-clock time is it in another?

That sounds like it should just be offset arithmetic, and most of the time
it is. The part that's easy to get wrong is the input clock time itself, near
a daylight saving transition:

- **Spring forward** skips an hour. `2024-03-10 02:30` never happens in
  `America/New_York` — clocks jump from 01:59:59 straight to 03:00:00.
- **Fall back** repeats an hour. `2024-11-03 01:30` happens twice in
  `America/New_York` — once before the clocks are set back, once after.

A tool that just adds an offset will silently make something up for both of
these. This one detects them and reports what actually happened instead of
guessing.

## How

`resolveCivilTime` reads the UTC offset a day before and a day after the
requested wall-clock time. If they're the same, there's no nearby transition
and the answer is unambiguous. If they differ, it builds one candidate
instant per offset and checks which one(s) actually format back to the
requested time:

- both match -> the time is ambiguous (fall-back overlap), both instants are
  real and returned as `earlier` / `later`.
- neither matches -> the time was skipped (spring-forward gap); both nearby
  interpretations are returned as `usingEarlierOffset` / `usingLaterOffset`
  so the caller can decide what to do.
- exactly one matches -> that's the answer.

Time zone data comes from `Intl`, which is backed by the ICU tz database
bundled with Node. There's no separate tz data package to install or keep in
sync.

## Usage

As a library:

```ts
import { convert } from './src/timezone.ts'

const result = convert(
  { year: 2024, month: 11, day: 3, hour: 1, minute: 30, second: 0 },
  'America/New_York',
  'Europe/London',
)

if (result.kind === 'ambiguous') {
  console.log(result.targetEarlier, result.targetLater)
}
```

From the command line:

```sh
node src/cli.ts --from America/New_York --to Europe/London --at 2024-11-03T01:30
```

```
2024-11-03T01:30:00 in America/New_York is ambiguous: it happens twice there.
  earlier occurrence -> 2024-11-03T09:30:00 in Europe/London
  later occurrence   -> 2024-11-03T10:30:00 in Europe/London
```

Zone names are whatever the IANA database calls them (`America/New_York`,
not `EST`). The `--at` value is a local wall-clock time in the `--from` zone,
in `YYYY-MM-DDTHH:mm[:ss]` form — no `Z`, no offset, because the whole point
is that it's ambiguous which offset applies.

## Running the tests

The test suite is table-driven: a list of `{ input, from, to, expected }`
cases run through `convert`, plus a handful of exact-instant checks for the
gap and overlap cases around known DST transitions in both hemispheres.

```sh
node --test test/
```

This project targets Node 22.6+, which can run `.ts` files directly by
stripping types at load time — no build step, no `ts-node`. On Node 22.x
that feature is still behind a flag:

```sh
node --experimental-strip-types --test test/
```

`npm run typecheck` runs `tsc --noEmit` for actual type checking; it's not
part of running the code.

## Known limitations

The gap/overlap detection assumes at most one DST transition within a day of
the requested time, which holds for every zone in the current tz database.

Zone names are checked against `Intl.supportedValuesOf('timeZone')` before
use; an unknown zone (typo, legacy abbreviation like `EST`, made-up name)
raises a plain error naming the bad zone instead of whatever
`Intl.DateTimeFormat` would throw.
