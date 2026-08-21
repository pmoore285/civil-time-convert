import { convert, formatCivil, type CivilDateTime } from './timezone.ts'

function parseCivil(text: string): CivilDateTime {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim())
  if (!match) {
    throw new Error(`could not parse "${text}" as YYYY-MM-DDTHH:mm[:ss]`)
  }
  const [, year, month, day, hour, minute, second] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string | undefined,
  ]
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: second ? Number(second) : 0,
  }
}

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
    throw new Error('usage: civil-time-convert --from <zone> --to <zone> --at <YYYY-MM-DDTHH:mm[:ss]>')
  }
  return { from: options.from, to: options.to, at: options.at }
}

function main(argv: string[]): void {
  let parsed: { from: string; to: string; at: string }
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
    return
  }

  const civil = parseCivil(parsed.at)
  const result = convert(civil, parsed.from, parsed.to)

  switch (result.kind) {
    case 'valid':
      console.log(`${formatCivil(civil)} in ${parsed.from} is ${formatCivil(result.target)} in ${parsed.to}`)
      break
    case 'ambiguous':
      console.log(`${formatCivil(civil)} in ${parsed.from} is ambiguous: it happens twice there.`)
      console.log(`  earlier occurrence -> ${formatCivil(result.targetEarlier)} in ${parsed.to}`)
      console.log(`  later occurrence   -> ${formatCivil(result.targetLater)} in ${parsed.to}`)
      break
    case 'gap':
      console.log(`${formatCivil(civil)} does not exist in ${parsed.from} (clocks skip over it).`)
      console.log(`  using the offset from before the jump -> ${formatCivil(result.targetUsingEarlierOffset)} in ${parsed.to}`)
      console.log(`  using the offset from after the jump  -> ${formatCivil(result.targetUsingLaterOffset)} in ${parsed.to}`)
      break
  }
}

main(process.argv.slice(2))
