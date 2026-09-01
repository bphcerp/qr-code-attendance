'use client'

import { useMemo, useState } from 'react'
import { Check, Download, Minus, Search, Table2 } from 'lucide-react'
import EmptyState from './EmptyState'
import StatusChip from './StatusChip'
import { Button } from '@/components/ui/button'
import { downloadFileName } from '@/lib/downloadName'
import type { AttendanceReport as Report, ReportStudent } from '@/lib/attendanceReport'

const columnFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  timeZone: 'Asia/Kolkata',
})

const fullFormatter = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
})

// en-CA gives YYYY-MM-DD, which sorts correctly as a spreadsheet column header.
const csvDateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Kolkata',
})

function percentage(present: number, total: number) {
  return total ? Math.round((present / total) * 100) : 0
}

// A name lifted out of an uploaded roster file is untrusted text. Quote every
// field that needs it, and blunt a leading formula character so opening the
// export in Excel cannot execute what was typed into the roster.
function csvField(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n')
}

export default function AttendanceReport({
  courseCode,
  report,
}: {
  courseCode: string
  report: Report
}) {
  const { sessions, students, presentBySession } = report
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return students
    return students.filter(
      (student) =>
        student.name.toLowerCase().includes(needle) ||
        student.studentId.toLowerCase().includes(needle) ||
        (student.email?.toLowerCase().includes(needle) ?? false),
    )
  }, [students, query])

  function download() {
    const rows: string[][] = [
      [
        'Student ID',
        'Name',
        ...sessions.map((session) => csvDateFormatter.format(new Date(session.startedAt))),
        'Present',
        'Classes',
        'Attendance %',
      ],
      ...students.map((student) => [
        student.studentId,
        student.onRoster ? student.name : `${student.name} (not on roster)`,
        ...student.marks.map((mark) => (mark ? 'P' : 'A')),
        String(student.present),
        String(sessions.length),
        String(percentage(student.present, sessions.length)),
      ]),
      [
        '',
        'Present per class',
        ...presentBySession.map(String),
        '',
        '',
        '',
      ],
    ]

    const blob = new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = downloadFileName(courseCode, 'attendance', 'csv')
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border p-5 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:p-6">
        <div>
          <h2 className="text-lg">Consolidated report</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every student against every completed class. A class still running is not counted
            until it is ended.
          </p>
        </div>
        <Button
          variant="outline"
          className="mt-3 sm:mt-0"
          onClick={download}
          disabled={!sessions.length || !students.length}
        >
          <Download aria-hidden="true" />
          Download CSV
        </Button>
      </div>

      {!sessions.length || !students.length ? (
        <div className="p-5 sm:p-6">
          <EmptyState icon={Table2} title={sessions.length ? 'No students yet' : 'No completed classes yet'}>
            {sessions.length
              ? 'Upload a roster or wait for students to enrol, and the report will fill in.'
              : 'Once you end a session, its date becomes a column here.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="border-b border-border px-5 py-4 sm:px-6">
            <label className="relative block sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <span className="sr-only">Search students</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search students"
                className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-ring"
              />
            </label>
          </div>

          {!visible.length ? (
            <p className="p-5 text-sm text-muted-foreground sm:p-6">
              No student matches “{query}”.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  Attendance for {courseCode}: one row per student, one column per completed class.
                </caption>
                <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="sticky left-0 z-10 bg-muted px-4 py-3 font-semibold">
                      Student
                    </th>
                    {sessions.map((session) => (
                      <th
                        key={session.id}
                        scope="col"
                        className="whitespace-nowrap px-3 py-3 text-center font-semibold"
                        title={fullFormatter.format(new Date(session.startedAt))}
                      >
                        {columnFormatter.format(new Date(session.startedAt))}
                      </th>
                    ))}
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                      Present
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                      %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((student) => (
                    <StudentRow
                      key={`${student.studentId}-${student.email ?? ''}`}
                      student={student}
                      total={sessions.length}
                    />
                  ))}
                </tbody>
                <tfoot className="border-t border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="row" className="sticky left-0 z-10 bg-muted px-4 py-3 text-left font-semibold">
                      Present per class
                    </th>
                    {presentBySession.map((count, column) => (
                      <td key={sessions[column].id} className="px-3 py-3 text-center font-mono">
                        {count}
                      </td>
                    ))}
                    <td className="px-4 py-3" colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function StudentRow({ student, total }: { student: ReportStudent; total: number }) {
  return (
    <tr>
      <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-normal">
        <span className="block whitespace-nowrap text-card-foreground">{student.name}</span>
        <span className="meta">{student.studentId}</span>
        {!student.onRoster && (
          <span className="ml-2 inline-block align-middle">
            <StatusChip tone="flagged">Not on roster</StatusChip>
          </span>
        )}
      </th>
      {student.marks.map((mark, column) => (
        <td key={column} className="px-3 py-3 text-center">
          {mark ? (
            <Check
              className="mx-auto size-4"
              style={{ color: 'var(--status-present)' }}
              aria-label="Present"
            />
          ) : (
            <Minus className="mx-auto size-4 text-muted-foreground" aria-label="Absent" />
          )}
        </td>
      ))}
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-card-foreground">
        {student.present} / {total}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-card-foreground">
        {percentage(student.present, total)}%
      </td>
    </tr>
  )
}
