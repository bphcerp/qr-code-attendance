'use client'

import { useRef, useState } from 'react'
import { ChevronDown, FileSpreadsheet, Trash2, Upload } from 'lucide-react'
import { parseRosterFile, type RosterRow } from '@/lib/parseRosterFile'
import { normalizeStudentId } from '@/lib/studentId'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/spinner'

export default function CourseRosterUpload({
  courseId,
  initialRoster,
}: {
  courseId: string
  initialRoster: RosterRow[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [roster, setRoster] = useState<RosterRow[]>(initialRoster)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function importRoster(file: File) {
    setBusy(true)
    clearFeedback()
    setFileName(file.name)
    try {
      const rows = await parseRosterFile(file)
      const response = await fetch(`/api/courses/${courseId}/roster`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(errorLabel(body.error))
      setRoster(rows)
      const imported: number = body.imported ?? rows.length
      const enrolled: number = body.enrolled ?? 0
      const unmatched: string[] = body.unmatched ?? []
      if (enrolled === 0) {
        // The whole point of the outage: a total mismatch used to read as
        // success. Say plainly that nobody was linked to an account and show a
        // few of the ids so the wrong column is obvious before class.
        const sample = unmatched.slice(0, 3).join(', ')
        setError(
          `${imported} rows imported but 0 matched a student account — no one will see this course yet. ` +
            `Check the sheet has an ID (e.g. 41120261453) or email column.${sample ? ` Unmatched: ${sample}…` : ''}`,
        )
      } else if (unmatched.length) {
        setMessage(
          `${imported} imported · ${enrolled} enrolled now · ${unmatched.length} not on the system yet ` +
            `(they'll be added the first time they sign in).`,
        )
      } else {
        setMessage(`${imported} imported · all ${enrolled} enrolled. The new roster replaces the previous one.`)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import the roster.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function removeStudent(student: RosterRow) {
    setRemovingId(student.studentId)
    clearFeedback()
    try {
      const response = await fetch(`/api/courses/${courseId}/roster`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: student.studentId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(errorLabel(body.error))

      const removedId = normalizeStudentId(student.studentId)
      setRoster((current) => current.filter((row) => normalizeStudentId(row.studentId) !== removedId))
      setMessage(`${student.studentName} removed from this course.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove the student.')
    } finally {
      setRemovingId(null)
    }
  }

  function clearFeedback() {
    setError(null)
    setMessage(null)
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="rounded-md bg-accent p-2 text-accent-foreground">
            <FileSpreadsheet size={20} />
          </div>
          <div>
            <h2 className="text-lg">Student roster</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Upload an Excel or CSV roster. Uploading replaces the whole list.
            </p>
          </div>
        </div>
        <p className="meta whitespace-nowrap">{roster.length} students</p>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center">
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx,.xlsm,.xlsb,.csv,.tsv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importRoster(file)
          }}
          disabled={busy}
        />
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Spinner /> : <Upload />}
          {busy ? 'Importing roster…' : 'Upload full roster'}
        </Button>
        {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
      </div>

      {message && <p className="mt-3 text-sm text-[var(--status-present)]">{message}</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Closed by default: a 600-row roster pushed the history and report a
          long way down the page, and the count above is usually all that's needed. */}
      {roster.length > 0 && (
        <details className="group mt-6 overflow-hidden rounded-md border border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-border bg-muted/30 px-4 py-3 group-open:border-b [&::-webkit-details-marker]:hidden">
            <h3 className="text-sm font-semibold">Students in roster</h3>
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="meta">{roster.length}</span>
              <ChevronDown size={16} className="transition-transform duration-150 group-open:rotate-180" />
            </span>
          </summary>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-border bg-card text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-16 px-4 py-2 font-medium">#</th>
                  <th scope="col" className="px-4 py-2 font-medium">ID Number</th>
                  <th scope="col" className="px-4 py-2 font-medium">Name</th>
                  <th scope="col" className="w-16 px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {roster.map((student, index) => (
                  <tr key={student.studentId}>
                    <td className="px-4 py-2 text-muted-foreground">{index + 1}</td>
                    <td className="px-4 py-2 font-mono text-xs">{student.studentId}</td>
                    <td className="px-4 py-2">{student.studentName}</td>
                    <td className="px-4 py-1 text-right">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${student.studentName}`}
                        disabled={removingId !== null}
                        onClick={() => void removeStudent(student)}
                      >
                        {removingId === student.studentId ? <Spinner /> : <Trash2 />}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}

function errorLabel(code?: string) {
  if (code === 'duplicate_student_id') return 'The roster contains a duplicate student ID.'
  if (code === 'invalid_roster') return 'Use a file with one ID Number and Name per student.'
  if (code === 'invalid_student') return 'Choose a valid student.'
  if (code === 'student_not_found') return 'That student is no longer available.'
  if (code === 'forbidden') return 'You do not have permission to manage this course.'
  return 'Could not update the roster. Try again.'
}
