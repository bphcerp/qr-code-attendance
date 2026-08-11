import { CalendarDays } from 'lucide-react'
import EmptyState from './EmptyState'
import StatusChip from './StatusChip'

export type HistoryRow = {
  id: string
  startedAt: string
  endedAt: string | null
  present: number
  roster: number
  studentPresent?: boolean
}

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
})

export default function AttendanceHistory({
  rows,
  studentView = false,
}: {
  rows: HistoryRow[]
  studentView?: boolean
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg">Attendance history</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {studentView ? 'Your attendance for every completed class.' : 'A session-by-session record for this course.'}
          </p>
        </div>
        <CalendarDays className="text-muted-foreground" size={20} />
      </div>

      {!rows.length ? (
        <div className="mt-5">
          <EmptyState icon={CalendarDays} title="No classes yet">
            Completed attendance sessions will appear here.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-semibold">Class</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 text-right font-semibold">Attendance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-3 text-card-foreground">
                    {dateFormatter.format(new Date(row.startedAt))}
                    {!row.endedAt && <span className="meta ml-2">Live</span>}
                  </td>
                  <td className="px-3 py-3">
                    {studentView ? (
                      <StatusChip tone={row.studentPresent ? 'present' : 'absent'}>
                        {row.studentPresent ? 'Present' : 'Absent'}
                      </StatusChip>
                    ) : (
                      <span className="text-muted-foreground">{row.endedAt ? 'Completed' : 'Live'}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-card-foreground">
                    {row.present} / {row.roster}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
