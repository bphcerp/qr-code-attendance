import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import * as XLSX from 'xlsx'

// Generates the roster fixtures used by verifyRosterFile.ts and the Playwright
// lifecycle spec. Synthetic ids only -- no real student data lands in git. The
// shapes mirror what real exports actually look like:
//   - ERP export: Notify | ID | ID Number | Name | ... , ERP id in "ID", the
//     campus id in "ID Number", names prefixed with an empty ".," salutation.
//   - campus-only: just the id-card number, which does NOT reduce to the email
//     core, so it must enrol nobody.
//   - email column: the reliable identifier when present.
//   - messy: leading/trailing spaces, a blank row, a numeric id.
//
// Regenerate with `npm run build:fixtures`; do not hand-edit the outputs.
const OUT = resolve(process.cwd(), 'test-fixtures')

// core = year + serial (8 digits). ERP = 411 + core. email = f + core.
const STUDENTS = [
  { core: '20260001', campus: '2026A7PS0001H', name: 'AAHI EXAMPLE' },
  { core: '20260002', campus: '2026A7PS0002H', name: 'BHARAT EXAMPLE' },
  { core: '20260003', campus: '2026B5PS0003H', name: 'CHARU EXAMPLE' },
  { core: '20260004', campus: '2026A4PS0004H', name: 'DEV EXAMPLE' },
  { core: '20260005', campus: '2026AAPS0005H', name: 'ESHA EXAMPLE' },
]

export const FIXTURE_STUDENTS = STUDENTS.map((s) => ({
  ...s,
  erp: `411${s.core}`,
  email: `f${s.core}@hyderabad.bits-pilani.ac.in`,
}))

function writeXlsx(name: string, aoa: string[][]) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'ps')
  writeFileSync(resolve(OUT, name), XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }))
  console.log('wrote', name, `(${aoa.length - 1} rows)`)
}

function writeText(name: string, content: string) {
  writeFileSync(resolve(OUT, name), content)
  console.log('wrote', name)
}

function main() {
  mkdirSync(OUT, { recursive: true })

  // The exact real shape that caused the SWE E112 outage.
  writeXlsx('roster_erp.xlsx', [
    ['Notify', 'ID', 'ID Number', 'Name', 'Grade Basis', 'Units', 'Level'],
    ...FIXTURE_STUDENTS.map((s) => ['', s.erp, s.campus, `.,${s.name}`, 'Sat/Unsat', '1', 'Yr 1 Sem 1']),
  ])

  // Only the id-card number -- must enrol nobody, loudly.
  writeXlsx('roster_campus_only.xlsx', [
    ['ID Number', 'Name'],
    ...FIXTURE_STUDENTS.map((s) => [s.campus, s.name]),
  ])

  // An email column present alongside an unusable id column.
  writeText(
    'roster_with_email.csv',
    ['Sl.No,ID Number,Name,Email', ...FIXTURE_STUDENTS.map((s, i) => `${i + 1},${s.campus},${s.name},${s.email}`)].join('\n') + '\n',
  )

  // Deliberately messy but valid: a leading serial column would poison the old
  // positional fallback, ids padded with spaces, a blank row in the middle.
  writeText(
    'roster_messy.csv',
    [
      'ID,Name',
      `  ${FIXTURE_STUDENTS[0].erp}  ,  ${FIXTURE_STUDENTS[0].name}  `,
      '',
      `${FIXTURE_STUDENTS[1].erp},${FIXTURE_STUDENTS[1].name}`,
      `${FIXTURE_STUDENTS[2].erp},${FIXTURE_STUDENTS[2].name}`,
    ].join('\n') + '\n',
  )
}

main()
