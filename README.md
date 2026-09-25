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

`resolveCivilTime` bisects the day before and the day after the requested
wall-clock time to find every distinct UTC offset the zone is on in that
window. One offset means there's no nearby transition and the answer is
unambiguous. More than one means it builds a candidate instant per offset
and checks which one(s) actually format back to the requested time:

- both match -> the time is ambiguous (fall-back overlap), both instants are
  real and returned as `earlier` / `later`.
- neither matches -> the time was skipped (spring-forward gap); both nearby
  interpretations are returned as `usingEarlierOffset` / `usingLaterOffset`
  so the caller can decide what to do.
- exactly one matches -> that's the answer.

Bisecting rather than just sampling the two endpoints also catches zones
that change their base offset and their DST rule within the same day: that
produces a third offset in between which can turn out to be the one that
actually round-trips, when a plain before/after probe would have missed it
and reported a bogus gap.

Time zone data comes from `Intl`, which is backed by the ICU tz database
bundled with Node. There's no separate tz data package to install or keep in
sync.

## Install

```sh
npm install -g civil-time-convert
```

This installs a `civil-time-convert` command backed by `src/cli.ts` directly —
there's no build step, so what you get is exactly what's in the repo. It
still needs the Node version in `engines` for type stripping (see "Running
the tests" below).

Prefer not to install anything? `npx civil-time-convert --from ... --to ...`
works the same way.

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

From the command line, once installed:

```sh
civil-time-convert --from America/New_York --to Europe/London --at 2024-11-03T01:30
```

Or straight from a checkout, without installing:

```sh
node src/cli.ts --from America/New_York --to Europe/London --at 2024-11-03T01:30
```

```
2024-11-03T01:30:00 in America/New_York is ambiguous: it happens twice there.
  earlier occurrence -> 2024-11-03T05:30:00 +00:00 in Europe/London
  later occurrence   -> 2024-11-03T06:30:00 +00:00 in Europe/London
```

Zone names are whatever the IANA database calls them (`America/New_York`,
not `EST`). The `--at` value is a local wall-clock time in the `--from` zone,
in `YYYY-MM-DDTHH:mm[:ss]` form — no `Z`, no offset, because the whole point
is that it's ambiguous which offset applies.

Not sure what a zone is called? List every name the runtime recognizes:

```sh
node src/cli.ts --list-zones
```

## HTTP

For callers that aren't Node, `src/server.ts` exposes the same logic over
plain JSON:

```sh
node src/server.ts
# civil-time-convert listening on http://localhost:8080
```

`PORT` overrides the default port. Two routes, both `GET`:

```sh
curl 'http://localhost:8080/convert?from=America/New_York&to=Europe/London&at=2024-11-03T01:30'
```

```json
{
  "kind": "ambiguous",
  "input": { "civil": "2024-11-03T01:30:00", "zone": "America/New_York" },
  "earlier": { "instant": "2024-11-03T05:30:00.000Z", "civil": "2024-11-03T05:30:00", "zone": "Europe/London", "offset": "+00:00" },
  "later": { "instant": "2024-11-03T06:30:00.000Z", "civil": "2024-11-03T06:30:00", "zone": "Europe/London", "offset": "+00:00" }
}
```

`kind` is `"valid"`, `"ambiguous"`, or `"gap"`, matching `convert`'s result;
a `"valid"` response carries a single `result` field instead of a pair.
Bad input (missing query parameter, unparseable `at`, unknown zone) comes
back as a 400 with `{ "error": "..." }` rather than a stack trace.

```sh
curl 'http://localhost:8080/zones'
```

returns `{ "zones": [...] }`, the same list as `--list-zones`.

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

The gap/overlap detection handles zones with more than one transition within
a day of the requested time (see "How" above), but it still only tracks two
candidate instants for an ambiguous or skipped time. A civil time that
round-trips under three or more distinct offsets would collapse to the
earliest and latest of them instead of reporting the middle one too. No zone
in the current tz database does this.

Zone names are checked against `Intl.supportedValuesOf('timeZone')` before
use; an unknown zone (typo, legacy abbreviation like `EST`, made-up name)
raises a plain error naming the bad zone instead of whatever
`Intl.DateTimeFormat` would throw.
