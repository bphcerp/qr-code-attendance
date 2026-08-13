import { parseRosterFile } from '../src/lib/parseRosterFile'

let passed = 0

async function expectRows(name: string, file: File, expected: unknown) {
  const actual = await parseRosterFile(file)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name}: ${JSON.stringify(actual)}`)
  }
  passed++
}

async function expectError(name: string, file: File, message: RegExp) {
  try {
    await parseRosterFile(file)
  } catch (error) {
    if (error instanceof Error && message.test(error.message)) {
      passed++
      return
    }
    throw error
  }
  throw new Error(`${name}: expected an error`)
}

async function main() {
  const expected = [
    { studentId: '2024A1PS0001H', studentName: 'Ada Lovelace' },
    { studentId: '2024A1PS0002H', studentName: 'Grace Hopper' },
  ]

  await expectRows(
    'CSV with quoted names',
    new File(['ID Number,Name\r\n2024A1PS0001H,"Ada Lovelace"\r\n2024A1PS0002H,Grace Hopper'], 'roster.csv'),
    expected,
  )
  await expectRows(
    'TSV roster',
    new File(['ID Number\tName\n2024A1PS0001H\tAda Lovelace\n2024A1PS0002H\tGrace Hopper'], 'roster.tsv'),
    expected,
  )
  await expectError(
    'legacy XLS rejection',
    new File(['not-a-workbook'], 'roster.xls'),
    /not supported/i,
  )
  await expectError(
    'unsupported extension rejection',
    new File(['id,name'], 'roster.json'),
    /\.xlsx, \.csv, or \.tsv/i,
  )
  await expectError(
    'file size limit',
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.csv'),
    /5 MB or smaller/i,
  )

  console.log(`${passed}/5 roster parser checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
