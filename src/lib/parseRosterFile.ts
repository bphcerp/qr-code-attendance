import * as XLSX from 'xlsx'

export type RosterRow = { studentId: string; studentName: string }

const idHeaders = new Set([
  'id',
  'idnumber',
  'studentid',
  'studentnumber',
  'rollno',
  'rollnumber',
  'registrationnumber',
  'regno',
  'admissionno',
])

const nameHeaders = new Set(['name', 'studentname', 'fullname', 'student'])

export async function parseRosterFile(file: File): Promise<RosterRow[]> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  const rows = extension === 'csv' || extension === 'tsv'
    ? parseDelimited(await file.text(), extension === 'tsv' ? '\t' : ',')
    : await parseExcel(await file.arrayBuffer())

  return normalizeRoster(rows)
}

function normalizeRoster(rows: string[][]) {
  const nonEmpty = rows.filter((row) => row.some((cell) => cell.trim()))
  if (!nonEmpty.length) throw new Error('The file does not contain any rows.')

  const first = nonEmpty[0].map(normalizeHeader)
  const idIndex = first.findIndex((header) => idHeaders.has(header))
  const nameIndex = first.findIndex((header) => nameHeaders.has(header))
  const hasHeader = idIndex >= 0 && nameIndex >= 0
  const resolvedIdIndex = hasHeader ? idIndex : 0
  const resolvedNameIndex = hasHeader ? nameIndex : 1
  const data = hasHeader ? nonEmpty.slice(1) : nonEmpty
  const seen = new Set<string>()
  const result: RosterRow[] = []

  for (const row of data) {
    const studentId = row[resolvedIdIndex]?.trim() ?? ''
    const studentName = row[resolvedNameIndex]?.trim() ?? ''
    const key = studentId.toLowerCase().replace(/\s+/g, '')
    if (!studentId && !studentName) continue
    if (!studentId || !studentName) throw new Error('Every roster row needs both an ID number and a name.')
    if (seen.has(key)) throw new Error(`Duplicate student ID: ${studentId}`)
    seen.add(key)
    result.push({ studentId, studentName })
  }

  if (!result.length) throw new Error('No student rows were found. Use ID and Name columns.')
  if (result.length > 5000) throw new Error('A roster can contain at most 5,000 students.')
  return result
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index++
    } else if (char === '"') {
      quoted = !quoted
    } else if (!quoted && char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

async function parseExcel(buffer: ArrayBuffer) {
  try {
    const workbook = XLSX.read(buffer, { type: 'array', cellText: true, cellNF: false })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) throw new Error('Could not find a worksheet in this Excel file.')
    const sheet = workbook.Sheets[firstSheetName]
    if (!sheet) throw new Error('Could not find the first worksheet in this Excel file.')
    return XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }).map((row) => row.map((cell) => String(cell ?? '')))
  } catch (error) {
    if (error instanceof Error && error.message.includes('worksheet')) throw error
    throw new Error('Could not read this Excel file. Make sure it is a valid .xls or .xlsx workbook.')
  }
}
