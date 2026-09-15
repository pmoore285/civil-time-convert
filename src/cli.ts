import {
  convert,
  formatCivil,
  formatOffset,
  listSupportedTimeZones,
  offsetMinutesAt,
  parseCivilTime,
  type CivilDateTime,
} from './timezone.ts'

function parseArgs(argv: string[]): { from: string; to: string; at: string } {
  const options: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg && arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`missing value for --${key}`)
      options[key] = value
      i += 1
    }
  }
  if (!options.from || !options.to || !options.at) {
    throw new Error(
      'usage: civil-time-convert --from <zone> --to <zone> --at <YYYY-MM-DDTHH:mm[:ss]>\n' +
        '   or: civil-time-convert --list-zones',
    )
  }
  return { from: options.from, to: options.to, at: options.at }
}

function main(argv: string[]): void {
  if (argv.includes('--list-zones')) {
    for (const zone of listSupportedTimeZones()) {
      console.log(zone)
    }
    return
  }

  let parsed: { from: string; to: string; at: string }
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
    return
  }

  let civil: CivilDateTime
  let result: ReturnType<typeof convert>
  try {
    civil = parseCivilTime(parsed.at)
    result = convert(civil, parsed.from, parsed.to)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
    return
  }

  // Renders a civil time together with the UTC offset actually in effect for
  // `zone` at `instant`, e.g. "2024-11-03T01:30:00 -05:00".
  const withOffset = (civilTime: CivilDateTime, instant: number, zone: string): string =>
    `${formatCivil(civilTime)} ${formatOffset(offsetMinutesAt(instant, zone))}`

  switch (result.kind) {
    case 'valid':
      console.log(
        `${withOffset(civil, result.instant, parsed.from)} in ${parsed.from} is ` +
          `${withOffset(result.target, result.instant, parsed.to)} in ${parsed.to}`,
      )
      break
    case 'ambiguous':
      console.log(`${formatCivil(civil)} in ${parsed.from} is ambiguous: it happens twice there.`)
      console.log(`  earlier occurrence -> ${withOffset(result.targetEarlier, result.earlier, parsed.to)} in ${parsed.to}`)
      console.log(`  later occurrence   -> ${withOffset(result.targetLater, result.later, parsed.to)} in ${parsed.to}`)
      break
    case 'gap':
      console.log(`${formatCivil(civil)} does not exist in ${parsed.from} (clocks skip over it).`)
      console.log(
        `  using the offset from before the jump -> ${withOffset(result.targetUsingEarlierOffset, result.usingEarlierOffset, parsed.to)} in ${parsed.to}`,
      )
      console.log(
        `  using the offset from after the jump  -> ${withOffset(result.targetUsingLaterOffset, result.usingLaterOffset, parsed.to)} in ${parsed.to}`,
      )
      break
  }
}

main(process.argv.slice(2))
