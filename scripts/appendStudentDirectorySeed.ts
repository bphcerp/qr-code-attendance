import { appendFileSync, readFileSync } from 'node:fs'

const [sourcePath, migrationPath] = process.argv.slice(2)

if (!sourcePath || !migrationPath) {
  throw new Error('Usage: tsx scripts/appendStudentDirectorySeed.ts <students.sql> <migration.sql>')
}

const seed = readFileSync(sourcePath, 'utf8')
const rowCount = (seed.match(/^  \('/gm) ?? []).length

if (rowCount !== 4122) {
  throw new Error(`Expected the vetted 4,122-row Nexus directory, got ${rowCount} rows`)
}

appendFileSync(
  migrationPath,
  `\n--> statement-breakpoint\n${seed}`,
)

console.log(`Appended ${rowCount} students to ${migrationPath}`)
