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
  if (extension === 'xls') {
    throw new Error('Legacy .xls files are not supported. Save the sheet as .xlsx or CSV first.')
  }
  const rows = extension === 'csv' || extension === 'tsv'
    ? parseDelimited(await file.text(), extension === 'tsv' ? '\t' : ',')
    : await parseXlsx(await file.arrayBuffer())

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

async function parseXlsx(buffer: ArrayBuffer) {
  const files = await readZip(buffer)
  const sheet = files.get('xl/worksheets/sheet1.xml')
  if (!sheet) throw new Error('Could not find the first worksheet in this Excel file.')
  const sharedStrings = files.get('xl/sharedStrings.xml')
  const shared = sharedStrings ? parseSharedStrings(new TextDecoder().decode(sharedStrings)) : []
  return parseWorksheet(new TextDecoder().decode(sheet), shared)
}

function parseSharedStrings(xml: string) {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  return Array.from(document.getElementsByTagName('si')).map((item) =>
    Array.from(item.getElementsByTagName('t')).map((text) => text.textContent ?? '').join(''),
  )
}

function parseWorksheet(xml: string, shared: string[]) {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const rows: string[][] = []
  for (const rowElement of Array.from(document.getElementsByTagName('row'))) {
    const row: string[] = []
    for (const cell of Array.from(rowElement.getElementsByTagName('c'))) {
      const reference = cell.getAttribute('r') ?? ''
      const column = columnIndex(reference)
      const value = cell.getElementsByTagName('v')[0]?.textContent ?? ''
      const type = cell.getAttribute('t')
      const parsed = type === 's' ? shared[Number(value)] ?? '' : type === 'inlineStr'
        ? cell.getElementsByTagName('t')[0]?.textContent ?? ''
        : value
      row[column] = parsed
    }
    rows.push(row.map((value) => value ?? ''))
  }
  return rows
}

function columnIndex(reference: string) {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A'
  let result = 0
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64
  return result - 1
}

async function readZip(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const decoder = new TextDecoder()
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw new Error('This is not a valid Excel workbook.')

  const directoryOffset = view.getUint32(end + 16, true)
  const directorySize = view.getUint32(end + 12, true)
  const files = new Map<string, Uint8Array>()
  let offset = directoryOffset
  const directoryEnd = directoryOffset + directorySize
  while (offset < directoryEnd && view.getUint32(offset, true) === 0x02014b50) {
    const compression = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength))
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.slice(start, start + compressedSize)
    files.set(name, await decompress(compressed, compression))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}

async function decompress(data: Uint8Array, compression: number) {
  if (compression === 0) return data
  if (compression !== 8 || typeof DecompressionStream === 'undefined') {
    throw new Error('This Excel file uses a compression format your browser cannot read.')
  }
  // The browser stream API is available in current Chrome, Edge, Safari, and Firefox.
  const input = new Uint8Array(data.byteLength)
  input.set(data)
  const stream = new Blob([input.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const result: Uint8Array[] = []
  const reader = stream.getReader()
  let total = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    result.push(chunk.value)
    total += chunk.value.length
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of result) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}
