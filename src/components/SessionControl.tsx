'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, ExternalLink, MapPin } from 'lucide-react'
import StatusChip from './StatusChip'
import { Button } from '@/components/ui/button'
import { STATIC_MINUTES_MAX } from '@/lib/token'

type OpenSession = {
  id: string
  startedAt: string
  rotationSeconds: number
  declaredDisplayCount: number
}

type Stats = {
  marked: number
  roster: number
  bySource: Record<string, number>
  flags: { kind: string; count: number }[]
  activeDisplays: number
  declaredDisplayCount: number
}

const flagLabels: Record<string, string> = {
  fingerprint_collision: 'Same device as another student',
  device_first_use: 'First scan on a new device',
  geo_outlier: 'Far from the room',
  geo_denied: 'Location refused',
  geo_imprecise: 'Weak GPS',
  device_recently_rebound: 'Device changed recently',
}

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
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [qrMode, setQrMode] = useState<'rotating' | 'static'>('rotating')
  const [rotationSeconds, setRotationSeconds] = useState(5)
  const [staticMinutes, setStaticMinutes] = useState(30)
  const [displayCount, setDisplayCount] = useState(1)
  const [room, setRoom] = useState<{ lat: number; lng: number } | null>(null)

  const [displayLink, setDisplayLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)

  const sessionId = openSession?.id

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false

    const poll = async () => {
      const res = await fetch(`/api/sessions/${sessionId}/stats`, { cache: 'no-store' })
      if (cancelled || !res.ok) return
      setStats(await res.json())
    }

    poll()
    const timer = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId])

  async function post(url: string, method: string, body?: unknown) {
    setBusy(true)
    setError(null)
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    setBusy(false)
    if (!res.ok) {
      const failed = await res.json().catch(() => ({}))
      setError(failed.error ?? 'request_failed')
      return null
    }
    return res.json()
  }

  async function start() {
    const created = await post(`/api/courses/${courseId}/sessions`, 'POST', {
      rotationSeconds: qrMode === 'static' ? staticMinutes * 60 : rotationSeconds,
      declaredDisplayCount: displayCount,
      roomLat: room?.lat ?? null,
      roomLng: room?.lng ?? null,
    })
    if (created) router.refresh()
  }

  async function generateLink() {
    const issued = await post(`/api/sessions/${sessionId}/display-token`, 'POST')
    if (issued) {
      setDisplayLink(`${window.location.origin}/display/${sessionId}?dt=${issued.token}`)
      setCopied(false)
    }
  }

  async function revokeLinks() {
    if (await post(`/api/sessions/${sessionId}/display-token`, 'DELETE')) setDisplayLink(null)
  }

  async function endSession() {
    if (await post(`/api/sessions/${sessionId}/end`, 'POST')) {
      setDisplayLink(null)
      setStats(null)
      router.refresh()
    }
  }

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => setRoom({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError('location_unavailable'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  return (
    <>
      <div className="my-8 flex items-center gap-4">
        <div>
          <h1 className="page-title">{courseCode}</h1>
          <p className="mt-1 text-muted-foreground">{courseTitle}</p>
        </div>
        {openSession && <StatusChip tone="live">Live</StatusChip>}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!openSession ? (
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="meta">Start a session</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm text-muted-foreground">QR mode</span>
              <div className="mt-1.5 inline-flex rounded-md border border-input p-1">
                <button
                  type="button"
                  onClick={() => setQrMode('rotating')}
                  className={
                    qrMode === 'rotating'
                      ? 'rounded-sm bg-accent px-3 py-1.5 text-sm font-bold text-accent-foreground'
                      : 'rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground'
                  }
                >
                  Rotating
                </button>
                <button
                  type="button"
                  onClick={() => setQrMode('static')}
                  className={
                    qrMode === 'static'
                      ? 'rounded-sm bg-accent px-3 py-1.5 text-sm font-bold text-accent-foreground'
                      : 'rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground'
                  }
                >
                  Static
                </button>
              </div>

              {qrMode === 'rotating' ? (
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={rotationSeconds}
                  onChange={(e) => setRotationSeconds(Number(e.target.value))}
                  aria-label="QR rotates every (seconds)"
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 font-mono text-card-foreground outline-none focus:border-ring"
                />
              ) : (
                <>
                  <input
                    type="number"
                    min={1}
                    max={STATIC_MINUTES_MAX}
                    value={staticMinutes}
                    onChange={(e) => setStaticMinutes(Number(e.target.value))}
                    aria-label="Stays the same for (minutes)"
                    className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 font-mono text-card-foreground outline-none focus:border-ring"
                  />
                  <span className="meta mt-1.5 block text-destructive">
                    Screenshots of this QR will work for the full {staticMinutes} minutes — pick the
                    shortest window that covers your session.
                  </span>
                </>
              )}
            </label>

            <label className="block">
              <span className="text-sm text-muted-foreground">Screens in this room</span>
              <input
                type="number"
                min={1}
                max={12}
                value={displayCount}
                onChange={(e) => setDisplayCount(Number(e.target.value))}
                className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2.5 font-mono text-card-foreground outline-none focus:border-ring"
              />
              <span className="meta mt-1.5 block">
                Flags the dashboard if more displays than this are live at once — catches a link left
                open somewhere unexpected.
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={useMyLocation}>
              <MapPin />
              {room ? 'Update room location' : 'Set room location'}
            </Button>
            <span className="meta">
              {room ? `${room.lat.toFixed(5)}, ${room.lng.toFixed(5)}` : 'Optional — no geo flags without it'}
            </span>
          </div>

          <Button size="lg" className="mt-6 h-12 w-full text-base sm:w-auto sm:px-8" disabled={busy} onClick={start}>
            Start session
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile
              label="Marked present"
              value={stats ? `${stats.marked}` : '—'}
              note={stats ? `of ${stats.roster} enrolled` : ' '}
            />
            <Tile
              label="Active displays"
              value={stats ? `${stats.activeDisplays}` : '—'}
              note={stats ? `${stats.declaredDisplayCount} declared` : ' '}
              // More screens polling than the room has is the signal that a
              // display link left the podium. It is meant to be visible, not
              // buried in an audit table nobody opens mid-lecture.
              alert={Boolean(stats && stats.activeDisplays > stats.declaredDisplayCount)}
            />
            <Tile
              label="Typed the code"
              value={stats ? `${stats.bySource.code ?? 0}` : '—'}
              note={stats ? `${stats.bySource.qr ?? 0} scanned the QR` : ' '}
            />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="meta">Projector link</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Open this on every screen in the room. It locks to the first machine that opens it,
                so generate it at the podium.
              </p>

              {displayLink ? (
                <>
                  <p className="mt-4 rounded-md border border-border bg-muted px-3 py-2.5 font-mono text-xs break-all text-card-foreground">
                    {displayLink}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(displayLink)
                        setCopied(true)
                      }}
                    >
                      <Copy />
                      {copied ? 'Copied' : 'Copy link'}
                    </Button>
                    <Button asChild>
                      <a href={displayLink} target="_blank" rel="noreferrer">
                        <ExternalLink />
                        Open display
                      </a>
                    </Button>
                  </div>
                </>
              ) : (
                <Button className="mt-4" disabled={busy} onClick={generateLink}>
                  Generate projector link
                </Button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={revokeLinks}
                className="mt-4 block text-sm text-primary underline underline-offset-4"
              >
                Revoke every link for this session
              </button>
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
              <p className="meta">Flags</p>
              {stats && stats.flags.some((f) => flagLabels[f.kind]) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {stats.flags
                    .filter((f) => flagLabels[f.kind])
                    .map((f) => (
                      <StatusChip key={f.kind} tone="flagged">
                        {flagLabels[f.kind]} · {f.count}
                      </StatusChip>
                    ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing flagged. A flag is a prompt to look, never a verdict on its own.
                </p>
              )}
            </div>
          </div>

          <Button
            variant="destructive"
            size="lg"
            className="mt-6 h-12 w-full text-base sm:w-auto sm:px-8"
            disabled={busy}
            onClick={endSession}
          >
            End session
          </Button>
        </>
      )}
    </>
  )
}

function Tile({
  label,
  value,
  note,
  alert,
}: {
  label: string
  value: string
  note: string
  alert?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="meta">{label}</p>
      <p
        className="mt-2 font-[family-name:var(--heading)] text-4xl font-extrabold tracking-[-1.2px] text-card-foreground"
        style={alert ? { color: 'var(--status-flagged)' } : undefined}
      >
        {value}
      </p>
      <p className="meta mt-1">{note}</p>
    </div>
  )
}
