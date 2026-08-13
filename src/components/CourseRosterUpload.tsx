'use client'

import { useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, Search, Trash2, Upload, UserPlus } from 'lucide-react'
import { parseRosterFile, type RosterRow } from '@/lib/parseRosterFile'
import { normalizeStudentId, studentIdFromEmail } from '@/lib/studentId'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/spinner'

type DirectoryStudent = {
  email: string
  fullName: string
  batch: number | null
  alreadyAdded: boolean
}

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
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<DirectoryStudent[]>([])
  const [searching, setSearching] = useState(false)
  const [addingEmail, setAddingEmail] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const query = term.trim()
    if (query.length < 2) return

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const response = await fetch(`/api/courses/${courseId}/roster?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(errorLabel(body.error))
        setResults(body.students ?? [])
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        setError(caught instanceof Error ? caught.message : 'Could not search the student directory.')
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 200)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [courseId, term])

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
      syncResultStatus(rows)
      setMessage(`${body.count} students imported. The new roster replaces the previous one.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import the roster.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function addStudent(student: DirectoryStudent) {
    setAddingEmail(student.email)
    clearFeedback()
    try {
      const response = await fetch(`/api/courses/${courseId}/roster`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: student.email }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(errorLabel(body.error))

      const added = body.student as RosterRow
      setRoster((current) => {
        const existing = current.findIndex(
          (row) => normalizeStudentId(row.studentId) === normalizeStudentId(added.studentId),
        )
        const next = existing >= 0
          ? current.map((row, index) => index === existing ? added : row)
          : [...current, added]
        return next.sort(compareStudents)
      })
      setResults((current) => current.map((row) => (
        row.email === student.email ? { ...row, alreadyAdded: true } : row
      )))
      setMessage(`${student.fullName} added to this course.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the student.')
    } finally {
      setAddingEmail(null)
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
      setResults((current) => current.map((row) => (
        studentIdFromEmail(row.email) === removedId ? { ...row, alreadyAdded: false } : row
      )))
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

  function syncResultStatus(rows: RosterRow[]) {
    const ids = new Set(rows.map((row) => normalizeStudentId(row.studentId)))
    setResults((current) => current.map((student) => ({
      ...student,
      alreadyAdded: ids.has(studentIdFromEmail(student.email)),
    })))
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
              Add students before or after they sign in, or upload a complete XLSX, CSV, or TSV roster.
            </p>
          </div>
        </div>
        <p className="meta whitespace-nowrap">{roster.length} students</p>
      </div>

      <div className="mt-5 max-w-xl">
        <label htmlFor="student-directory-search" className="text-sm font-medium">
          Add a student
        </label>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            id="student-directory-search"
            type="search"
            className="h-9 w-full rounded-md border border-input bg-transparent py-1 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            placeholder="Search by name or BITS ID"
            value={term}
            onChange={(event) => {
              const value = event.target.value
              setTerm(value)
              if (value.trim().length < 2) {
                setResults([])
                setSearching(false)
              }
              setError(null)
            }}
          />
        </div>

        {term.trim().length >= 2 && (
          <div id="student-directory-results" aria-live="polite" className="mt-2 overflow-hidden rounded-md border border-border">
            {searching && <p className="px-3 py-3 text-sm text-muted-foreground">Searching…</p>}
            {!searching && results.length === 0 && (
              <p className="px-3 py-3 text-sm text-muted-foreground">No student found.</p>
            )}
            {!searching && results.length > 0 && (
              <ul aria-label="Student search results">
                {results.map((student) => (
                  <li key={student.email} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{student.fullName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {student.email.split('@')[0]}
                        {student.batch ? ` · ${student.batch}` : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={student.alreadyAdded ? 'secondary' : 'default'}
                      disabled={student.alreadyAdded || addingEmail !== null}
                      onClick={() => void addStudent(student)}
                    >
                      {addingEmail === student.email ? <Spinner /> : <UserPlus />}
                      {student.alreadyAdded ? 'Added' : addingEmail === student.email ? 'Adding…' : 'Add'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv,.tsv"
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

      {roster.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-md border border-border">
          <div className="border-b border-border bg-muted/30 px-4 py-3">
            <h3 className="text-sm font-semibold">Students in roster</h3>
          </div>
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
        </div>
      )}
    </section>
  )
}

function compareStudents(a: RosterRow, b: RosterRow) {
  return a.studentName.localeCompare(b.studentName) || a.studentId.localeCompare(b.studentId)
}

function errorLabel(code?: string) {
  if (code === 'duplicate_student_id') return 'The roster contains a duplicate student ID.'
  if (code === 'invalid_roster') return 'Use a file with one ID Number and Name per student.'
  if (code === 'invalid_student') return 'Choose a valid student.'
  if (code === 'student_not_found') return 'That student is no longer available.'
  if (code === 'forbidden') return 'You do not have permission to manage this course.'
  return 'Could not update the roster. Try again.'
}
