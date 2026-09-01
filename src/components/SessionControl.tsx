'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, MapPin, QrCode, RefreshCw, Search } from 'lucide-react'
import QRCode from 'qrcode'
import ProjectorDisplay from './ProjectorDisplay'
import StatusChip from './StatusChip'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/spinner'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { courseSlug, downloadTimestamp } from '@/lib/downloadName'
import { STATIC_MINUTES_MAX } from '@/lib/tokenFormat'

type OpenSession = {
  id: string
  startedAt: string
  rotationSeconds: number
  declaredDisplayCount: number
}

type StudentAttendance = {
  studentId: string
  email: string | null
  name: string
  markedAt: string | null
  source: 'qr' | 'code' | 'manual' | null
}

type Stats = {
  marked: number
  roster: number
  bySource: Record<string, number>
  flags: { kind: string; count: number }[]
  activeDisplays: number
  declaredDisplayCount: number
  students: StudentAttendance[]
}

const flagLabels: Record<string, string> = {
  fingerprint_collision: 'Same phone model as another student',
  device_first_use: 'First scan on a new device',
  geo_outlier: 'Far from the room',
  geo_denied: 'Location refused',
  geo_imprecise: 'Weak GPS',
  device_recently_rebound: 'Device changed recently',
}

const errorLabels: Record<string, string> = {
  request_failed: 'Couldn’t reach the server. Check the hall Wi-Fi and try again.',
  internal_error: 'The server hit a problem. Try again in a moment.',
  location_unavailable: 'Your location is unavailable. You can still start without it.',
  unauthenticated: 'Your sign-in expired. Sign in again and retry.',
  forbidden: 'This account does not have permission to manage this course.',
  not_found: 'This session could not be found. Refresh the page and try again.',
  invalid_rotation_seconds: 'Choose a valid QR rotation time.',
  session_already_open: 'This course already has a live attendance session.',
}

const timestampFormatter = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'Asia/Kolkata',
})

type BusyAction = 'start' | 'generate' | 'revoke' | 'end'

type QrMode = 'rotating' | 'static' | 'announced'

// How the live session is shown to the room. Kept in the browser rather than on
// the session row: it changes nothing the server checks, and a class that moves
// indoors halfway through should be able to switch without restarting.
type Presentation = 'qr' | 'code'

export default function SessionControl({
  courseId,
  courseCode,
  courseTitle,
  openSession,
}: {
  courseId: string
  courseCode: string
  courseTitle: string
  openSession: OpenSession | null
}) {
  const [activeSession, setActiveSession] = useState<OpenSession | null>(openSession)
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const [qrMode, setQrMode] = useState<QrMode>('rotating')
  const [rotationSeconds, setRotationSeconds] = useState(5)
  const [staticMinutes, setStaticMinutes] = useState(30)
  // Two minutes: long enough to say the code, have it repeated at the back and
  // let people type it, short enough that relaying it to someone off the ground
  // is a race rather than a formality.
  const [announcedMinutes, setAnnouncedMinutes] = useState(2)
  const [presentation, setPresentation] = useState<Presentation>('qr')
  const [room, setRoom] = useState<{ lat: number; lng: number } | null>(null)
  const [displayToken, setDisplayToken] = useState<string | null>(null)
  const [currentToken, setCurrentToken] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [studentQuery, setStudentQuery] = useState('')

  const sessionId = activeSession?.id
  const busy = busyAction !== null
  const visibleStudents = useMemo(() => {
    if (!stats) return []
    const query = studentQuery.trim().toLowerCase()
    if (!query) return stats.students
    return stats.students.filter(
      (student) =>
        student.name.toLowerCase().includes(query) ||
        student.studentId.toLowerCase().includes(query) ||
        student.email?.toLowerCase().includes(query),
    )
  }, [stats, studentQuery])

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let pollRun = 0

    const poll = async () => {
      if (cancelled || document.visibilityState === 'hidden') return
      const run = ++pollRun
      controller = new AbortController()
      try {
        const res = await fetch(`/api/sessions/${sessionId}/stats`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (cancelled || !res.ok) return
        setStats(await res.json())
      } catch {
        // A later poll can recover from a brief classroom Wi-Fi interruption.
      } finally {
        if (!cancelled && run === pollRun && document.visibilityState === 'visible') {
          timer = setTimeout(poll, 5000)
        }
      }
    }

    const onVisibilityChange = () => {
      pollRun++
      if (timer) clearTimeout(timer)
      controller?.abort()
      if (document.visibilityState === 'visible') poll()
    }

    poll()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const timer = window.setTimeout(() => {
      setDisplayToken(sessionStorage.getItem(displayStorageKey(sessionId)))
      const stored = sessionStorage.getItem(presentationStorageKey(sessionId))
      if (stored === 'code' || stored === 'qr') setPresentation(stored)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [sessionId])

  async function post(url: string, method: string, action: BusyAction, body?: unknown) {
    setBusyAction(action)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const failed = await res.json().catch(() => ({}))
        setError(failed.error ?? 'request_failed')
        return null
      }
      return res.json()
    } catch {
      setError('request_failed')
      return null
    } finally {
      setBusyAction(null)
    }
  }

  function chosenRotationSeconds() {
    if (qrMode === 'static') return staticMinutes * 60
    if (qrMode === 'announced') return announcedMinutes * 60
    return rotationSeconds
  }

  async function start() {
    const seconds = chosenRotationSeconds()
    const created = await post(`/api/courses/${courseId}/sessions`, 'POST', 'start', {
      rotationSeconds: seconds,
      declaredDisplayCount: 1,
      roomLat: room?.lat ?? null,
      roomLng: room?.lng ?? null,
    })
    if (created) {
      const shown: Presentation = qrMode === 'announced' ? 'code' : 'qr'
      sessionStorage.setItem(displayStorageKey(created.id), created.displayToken)
      sessionStorage.setItem(presentationStorageKey(created.id), shown)
      setDisplayToken(created.displayToken)
      setPresentation(shown)
      setStats(null)
      setActiveSession({
        id: created.id,
        startedAt: created.startedAt,
        rotationSeconds: seconds,
        declaredDisplayCount: 1,
      })
    }
  }

  function showAs(next: Presentation) {
    setPresentation(next)
    if (sessionId) sessionStorage.setItem(presentationStorageKey(sessionId), next)
  }

  async function generateDisplay() {
    const issued = await post(`/api/sessions/${sessionId}/display-token`, 'POST', 'generate')
    if (issued && sessionId) {
      setDisplayToken(issued.token)
      sessionStorage.setItem(displayStorageKey(sessionId), issued.token)
    }
  }

  async function revokeDisplays() {
    if (await post(`/api/sessions/${sessionId}/display-token`, 'DELETE', 'revoke')) {
      setDisplayToken(null)
      setCurrentToken(null)
      if (sessionId) sessionStorage.removeItem(displayStorageKey(sessionId))
      setRevokeOpen(false)
    }
  }

  async function endSession() {
    if (await post(`/api/sessions/${sessionId}/end`, 'POST', 'end')) {
      setDisplayToken(null)
      setCurrentToken(null)
      if (sessionId) sessionStorage.removeItem(displayStorageKey(sessionId))
      setStats(null)
      setEndOpen(false)
      setActiveSession(null)
    }
  }

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => setRoom({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError('location_unavailable'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  async function downloadQr() {
    if (!currentToken || !activeSession || presentation === 'code') return

    const dataUrl = await QRCode.toDataURL(currentToken, {
      errorCorrectionLevel: 'L',
      margin: 2,
      width: 1024,
      color: { dark: '#000000', light: '#ffffff' },
    })
    const blob = await fetch(dataUrl).then((response) => response.blob())
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${courseSlug(courseCode)}-${downloadTimestamp()}.png`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="my-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="page-title">{courseCode}</h1>
            {activeSession && <StatusChip tone="live">Live</StatusChip>}
          </div>
          <p className="mt-1 text-muted-foreground">{courseTitle}</p>
          {activeSession && (
            <p className="meta mt-2">Started {formatTimestamp(activeSession.startedAt)}</p>
          )}
        </div>

        {activeSession && (
          <EndSessionDialog
            courseCode={courseCode}
            busy={busy}
            busyAction={busyAction}
            marked={stats?.marked}
            roster={stats?.roster}
            open={endOpen}
            onOpenChange={setEndOpen}
            onEnd={endSession}
          />
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
        >
          {errorLabels[error] ?? 'Something went wrong. Try again.'}
        </p>
      )}

      {!activeSession ? (
        <section className="animate-in fade-in-0 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow)] duration-150">
          <div className="flex items-start gap-3 border-b border-border p-5 sm:p-6">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <QrCode aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 className="text-xl">Start attendance</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Choose how the QR behaves, then begin. The live code and student timestamps stay on this page.
              </p>
            </div>
          </div>

          <div className="grid divide-y divide-border lg:grid-cols-[1.15fr_0.85fr] lg:divide-x lg:divide-y-0">
            <fieldset className="min-w-0 p-5 sm:p-6">
              <legend className="text-sm font-semibold text-card-foreground">QR security</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="QR mode">
                <button
                  type="button"
                  role="radio"
                  aria-checked={qrMode === 'rotating'}
                  onClick={() => setQrMode('rotating')}
                  className={`rounded-lg border p-4 text-left transition-[border-color,background-color,box-shadow] ${
                    qrMode === 'rotating'
                      ? 'border-primary bg-accent shadow-sm'
                      : 'border-border bg-background hover:border-primary/50'
                  }`}
                >
                  <span className="block text-sm font-bold text-card-foreground">Rotating QR</span>
                  <span className="mt-1 block text-sm text-muted-foreground">Changes every few seconds for stronger protection.</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={qrMode === 'announced'}
                  onClick={() => setQrMode('announced')}
                  className={`rounded-lg border p-4 text-left transition-[border-color,background-color,box-shadow] ${
                    qrMode === 'announced'
                      ? 'border-primary bg-accent shadow-sm'
                      : 'border-border bg-background hover:border-primary/50'
                  }`}
                >
                  <span className="block text-sm font-bold text-card-foreground">Announced code</span>
                  <span className="mt-1 block text-sm text-muted-foreground">For the ground, or anywhere with nothing to project onto. Read the code out.</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={qrMode === 'static'}
                  onClick={() => setQrMode('static')}
                  className={`rounded-lg border p-4 text-left transition-[border-color,background-color,box-shadow] ${
                    qrMode === 'static'
                      ? 'border-primary bg-accent shadow-sm'
                      : 'border-border bg-background hover:border-primary/50'
                  }`}
                >
                  <span className="block text-sm font-bold text-card-foreground">Static QR</span>
                  <span className="mt-1 block text-sm text-muted-foreground">Stays fixed when rotation is impractical.</span>
                </button>
              </div>

              <label className="mt-4 block rounded-lg bg-muted/50 p-4">
                <span className="text-sm font-medium text-card-foreground">
                  {qrMode === 'rotating'
                    ? 'Rotate every'
                    : qrMode === 'announced'
                      ? 'New code every'
                      : 'Keep active for'}
                </span>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="number"
                    min={qrMode === 'rotating' ? 3 : 1}
                    max={
                      qrMode === 'rotating' ? 30 : qrMode === 'announced' ? 30 : STATIC_MINUTES_MAX
                    }
                    value={
                      qrMode === 'rotating'
                        ? rotationSeconds
                        : qrMode === 'announced'
                          ? announcedMinutes
                          : staticMinutes
                    }
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (qrMode === 'rotating') setRotationSeconds(value)
                      else if (qrMode === 'announced') setAnnouncedMinutes(value)
                      else setStaticMinutes(value)
                    }}
                    className="h-10 w-24 rounded-md border border-input bg-background px-3 font-mono text-card-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                  <span className="text-sm text-muted-foreground">
                    {qrMode === 'rotating' ? 'seconds' : 'minutes'}
                  </span>
                </div>
                <span className={`mt-2 block text-sm ${qrMode === 'static' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {qrMode === 'rotating'
                    ? 'Five seconds is recommended for most classrooms.'
                    : qrMode === 'announced'
                      ? 'Long enough to say it and have it repeated at the back. Anyone off the ground has to be told it within the same window.'
                      : `Screenshots remain valid for all ${staticMinutes} minutes.`}
                </span>
              </label>
            </fieldset>

            <div className="flex min-w-0 flex-col p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <MapPin aria-hidden="true" className="size-4 text-primary" />
                <h3 className="text-sm font-semibold text-card-foreground">Classroom location</h3>
                <span className="meta">Optional</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Add this device&rsquo;s location to flag scans that happen far from the room.
              </p>
              <Button variant="outline" className="mt-4 w-full sm:w-fit" onClick={useMyLocation}>
                <MapPin />
                {room ? 'Update location' : 'Use this location'}
              </Button>
              <p className="meta mt-3 break-all">
                {room ? `${room.lat.toFixed(5)}, ${room.lng.toFixed(5)}` : 'No location added'}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-border bg-muted/30 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="text-sm font-semibold text-card-foreground">Ready for class</p>
              <p className="mt-0.5 text-sm text-muted-foreground">The QR appears immediately after you start.</p>
            </div>
            <Button
              size="lg"
              className="h-12 w-full text-base sm:w-auto sm:min-w-48 sm:px-8"
              disabled={busy}
              onClick={start}
            >
              {busyAction === 'start' ? <Spinner /> : <QrCode />}
              {busyAction === 'start' ? 'Starting attendance…' : 'Start attendance'}
            </Button>
          </div>
        </section>
      ) : (
        <div className="animate-in fade-in-0 duration-150">
          <div className="space-y-4">
            <div className="space-y-4">
              <section className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow)] sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-extrabold text-card-foreground">
                      {presentation === 'code' ? 'Read the code out' : 'Scan to mark attendance'}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {presentation === 'code'
                        ? 'Students type it on their own phones. Nothing needs to be projected.'
                        : 'The QR updates securely on this page—no new tab or link needed.'}
                    </p>
                  </div>
                  {displayToken && <StatusChip tone="live">On</StatusChip>}
                </div>

                {displayToken && (
                  <div
                    className="mb-4 inline-flex rounded-md border border-border p-0.5"
                    role="radiogroup"
                    aria-label="How to show the session"
                  >
                    {(['qr', 'code'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={presentation === option}
                        onClick={() => showAs(option)}
                        className={`rounded px-3 py-1.5 text-sm transition-colors ${
                          presentation === option
                            ? 'bg-accent font-semibold text-accent-foreground'
                            : 'text-muted-foreground hover:text-card-foreground'
                        }`}
                      >
                        {option === 'qr' ? 'Show QR' : 'Big code'}
                      </button>
                    ))}
                  </div>
                )}

                {displayToken ? (
                  <ProjectorDisplay
                    sessionId={activeSession.id}
                    displayToken={displayToken}
                    variant={presentation === 'code' ? 'code' : 'embedded'}
                    onToken={setCurrentToken}
                  />
                ) : (
                  <div className="flex min-h-[min(68vh,640px)] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center">
                    <p className="font-medium text-card-foreground">Display is off</p>
                    <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                      Show the secure QR right here when the classroom is ready.
                    </p>
                    <Button className="mt-4" disabled={busy} onClick={generateDisplay}>
                      {busyAction === 'generate' && <Spinner />}
                      {busyAction === 'generate' ? 'Starting display…' : 'Show QR here'}
                    </Button>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="meta">
                      {stats ? `${stats.activeDisplays} active display${stats.activeDisplays === 1 ? '' : 's'}` : 'Checking display'}
                    </p>
                    {displayToken && presentation === 'qr' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {activeSession.rotationSeconds < 60
                          ? `This code expires in ${activeSession.rotationSeconds} seconds. The download is a snapshot.`
                          : 'This code stays valid until the session’s next change. The download is a snapshot.'}
                      </p>
                    )}
                  </div>
                  {displayToken && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!currentToken || presentation === 'code'}
                        onClick={() => void downloadQr()}
                      >
                        <Download /> Download QR
                      </Button>
                      <Dialog open={revokeOpen} onOpenChange={(open) => !busy && setRevokeOpen(open)}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={busy}>
                            <RefreshCw /> Reset display
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Reset the attendance display?</DialogTitle>
                            <DialogDescription>
                              The current QR will stop immediately. Select “Show QR here” afterwards to
                              start a fresh display.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline" disabled={busy}>Cancel</Button>
                            </DialogClose>
                            <Button variant="destructive" onClick={revokeDisplays} disabled={busy}>
                              {busyAction === 'revoke' && <Spinner />}
                              {busyAction === 'revoke' ? 'Resetting…' : 'Reset display'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  )}
                </div>
              </section>

              <div className="grid gap-3 sm:grid-cols-3" aria-busy={stats === null}>
                <Tile
                  label="Present"
                  value={stats ? `${stats.marked}` : null}
                  note={stats ? `of ${stats.roster} students` : undefined}
                />
                <Tile
                  label="Waiting"
                  value={stats ? `${Math.max(0, stats.roster - stats.marked)}` : null}
                  note="Not marked yet"
                />
                <Tile
                  label="Attendance"
                  value={stats ? `${stats.roster ? Math.round((stats.marked / stats.roster) * 100) : 0}%` : null}
                  note={stats ? `${stats.bySource.qr ?? 0} QR · ${stats.bySource.code ?? 0} code` : undefined}
                />
              </div>

              <section className="rounded-lg border border-border bg-card p-5">
                <p className="font-bold text-card-foreground">Review flags</p>
                {stats && stats.flags.some((flag) => flagLabels[flag.kind]) ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {stats.flags
                      .filter((flag) => flagLabels[flag.kind])
                      .map((flag) => (
                        <StatusChip key={flag.kind} tone="flagged">
                          {flagLabels[flag.kind]} · {flag.count}
                        </StatusChip>
                      ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Nothing flagged. A flag is a prompt to review, never a verdict.
                  </p>
                )}
              </section>
            </div>

            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
                <div>
                  <h2 className="font-bold text-card-foreground">Student timestamps</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Updates automatically every five seconds.
                  </p>
                </div>
                <label className="relative mt-3 block sm:mt-0 sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <span className="sr-only">Search students</span>
                  <input
                    type="search"
                    value={studentQuery}
                    onChange={(event) => setStudentQuery(event.target.value)}
                    placeholder="Search students"
                    className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-ring"
                  />
                </label>
              </div>

              {!stats ? (
                <div className="space-y-3 p-4" aria-label="Student list loading">
                  {[0, 1, 2, 3].map((row) => (
                    <div key={row} className="h-14 animate-pulse rounded-md bg-muted" />
                  ))}
                </div>
              ) : visibleStudents.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Student</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Marked at</th>
                        <th className="px-4 py-3 font-semibold">Method</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visibleStudents.map((student) => (
                        <tr key={student.studentId} className="transition-colors hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <p className="font-medium text-card-foreground">{student.name}</p>
                            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                              {student.studentId}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <StatusChip tone={student.markedAt ? 'present' : 'pending'}>
                              {student.markedAt ? 'Present' : 'Waiting'}
                            </StatusChip>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-card-foreground">
                            {student.markedAt ? formatTimestamp(student.markedAt) : '—'}
                          </td>
                          <td className="px-4 py-3 capitalize text-muted-foreground">
                            {student.source ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  No students match “{studentQuery}”.
                </p>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  )
}

function EndSessionDialog({
  courseCode,
  busy,
  busyAction,
  marked,
  roster,
  open,
  onOpenChange,
  onEnd,
}: {
  courseCode: string
  busy: boolean
  busyAction: BusyAction | null
  marked?: number
  roster?: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onEnd: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogTrigger asChild>
        <Button variant="destructive" disabled={busy}>End session</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>End attendance for {courseCode}?</DialogTitle>
          <DialogDescription>
            {marked != null && roster != null ? `${marked} of ${roster} students have marked. ` : ''}
            Students still waiting will no longer be able to scan, and this session cannot be reopened.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>Keep session open</Button>
          </DialogClose>
          <Button variant="destructive" onClick={onEnd} disabled={busy}>
            {busyAction === 'end' && <Spinner />}
            {busyAction === 'end' ? 'Ending session…' : 'End session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Tile({
  label,
  value,
  note,
}: {
  label: string
  value: string | null
  note?: string
}) {
  return (
    <div
      className="rounded-lg border border-border bg-card p-5"
      aria-label={value === null ? `${label} loading` : undefined}
    >
      <p className="meta">{label}</p>
      {value === null ? (
        <div aria-hidden="true">
          <div className="mt-3 h-9 w-14 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-24 animate-pulse rounded bg-muted" />
        </div>
      ) : (
        <>
          <p className="stat mt-2">{value}</p>
          <p className="meta mt-1">{note}</p>
        </>
      )}
    </div>
  )
}

function displayStorageKey(sessionId: string) {
  return `attendance-display:${sessionId}`
}

function presentationStorageKey(sessionId: string) {
  return `attendance-presentation:${sessionId}`
}

function formatTimestamp(value: string) {
  return timestampFormatter.format(new Date(value))
}
