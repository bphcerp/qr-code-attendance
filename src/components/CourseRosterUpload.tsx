'use client'

import { useRef, useState } from 'react'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { parseRosterFile } from '@/lib/parseRosterFile'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/spinner'

export default function CourseRosterUpload({
  courseId,
  initialCount,
}: {
  courseId: string
  initialCount: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [count, setCount] = useState(initialCount)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function importRoster(file: File) {
    setBusy(true)
    setError(null)
    setMessage(null)
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
      setCount(body.count)
      setMessage(`${body.count} students imported. The new roster replaces the previous one.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import the roster.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
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
              Upload an Excel (<code>.xls</code> or <code>.xlsx</code>) or CSV file with <code>ID Number</code> and <code>Name</code> columns.
              IDs should match the student email ID before <code>@</code> so first-time students are enrolled automatically.
            </p>
          </div>
        </div>
        <p className="meta whitespace-nowrap">{count} students</p>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx,.csv,.tsv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importRoster(file)
          }}
          disabled={busy}
        />
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Spinner /> : <Upload />}
          {busy ? 'Importing roster…' : 'Upload roster'}
        </Button>
        {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
      </div>

      {message && <p className="mt-3 text-sm text-[var(--status-present)]">{message}</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

function errorLabel(code?: string) {
  if (code === 'duplicate_student_id') return 'The roster contains a duplicate student ID.'
  if (code === 'invalid_roster') return 'Use a file with one ID Number and Name per student.'
  if (code === 'forbidden') return 'You do not have permission to manage this course.'
  return 'Could not import the roster. Try again.'
}
