'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { deviceFingerprint } from '@/lib/fingerprint'
import { Button } from '@/components/ui/button'

type Phase = 'scanning' | 'sending' | 'done' | 'failed'

type Geo = { lat?: number; lng?: number; accuracy?: number; denied?: boolean }

type ZoomRange = { min: number; max: number; step: number }

const failureLabels: Record<string, string> = {
  invalid_token: 'That code is not valid for this class. Point at the projector and try again.',
  token_expired: 'That code had already rotated. Try the one on screen now.',
  session_closed: 'This class has stopped taking attendance.',
  not_enrolled: 'You are not on the roster for this course.',
  already_marked: 'You are already marked present for this class.',
  device_mismatch:
    'This is not the phone registered to your account. Ask your instructor to approve a device change.',
  bad_request: 'Something was missing from the scan. Try again.',
  unauthenticated: 'Your sign-in expired. Sign in again.',
}

// Retrying only helps when the token itself was the problem. Everything else is
// settled -- re-scanning an already-marked student just produces the same 409.
const retryable = new Set(['invalid_token', 'token_expired', 'bad_request', 'unknown'])

export default function Scanner({
  sessionId,
  courseCode,
  courseTitle,
}: {
  sessionId: string
  courseCode: string
  courseTitle: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const geoRef = useRef<Geo>({})

  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>('scanning')
  const [failure, setFailure] = useState<string | null>(null)
  const [cameraBlocked, setCameraBlocked] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [code, setCode] = useState('')
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) {
      geoRef.current = { denied: true }
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoRef.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }
      },
      () => {
        geoRef.current = { denied: true }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    )
  }, [])

  const submit = useCallback(
    async (raw: string) => {
      setPhase('sending')
      const geo = geoRef.current

      try {
        const res = await fetch('/api/attendance/mark', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            token: raw,
            fingerprint: await deviceFingerprint(),
            lat: geo.lat,
            lng: geo.lng,
            accuracy: geo.accuracy,
            geoDenied: geo.denied ?? false,
          }),
        })

        if (res.ok) {
          setPhase('done')
          return
        }

        const body = await res.json().catch(() => ({}))
        setFailure(body.error ?? 'unknown')
      } catch {
        setFailure('unknown')
      }
      setPhase('failed')
    },
    [sessionId],
  )

  useEffect(() => {
    let cancelled = false
    const reader = new BrowserQRCodeReader()

    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current ?? undefined,
        (result) => {
          if (!result || cancelled) return
          controlsRef.current?.stop()
          submit(result.getText())
        },
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls

        const stream = videoRef.current?.srcObject as MediaStream | null
        const capabilities = stream?.getVideoTracks()[0]?.getCapabilities?.() as
          | (MediaTrackCapabilities & { zoom?: ZoomRange })
          | undefined
        if (capabilities?.zoom) {
          setZoomRange({ ...capabilities.zoom, step: capabilities.zoom.step || 0.1 })
        }
      })
      .catch(() => {
        if (cancelled) return
        setCameraBlocked(true)
        setCodeOpen(true)
      })

    // The default framing assumes an arm's-length QR. From row 20 the code is
    // going to take a while, so the typed fallback appears on its own rather
    // than waiting for the student to work out that it exists.
    const unlock = setTimeout(() => setCodeOpen(true), 8000)

    return () => {
      cancelled = true
      clearTimeout(unlock)
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [attempt, submit])

  useEffect(() => {
    if (phase === 'scanning') return
    controlsRef.current?.stop()
    controlsRef.current = null
  }, [phase])

  function applyZoom(value: number) {
    const stream = videoRef.current?.srcObject as MediaStream | null
    const track = stream?.getVideoTracks()[0]
    track?.applyConstraints({ advanced: [{ zoom: value }] } as unknown as MediaTrackConstraints)
  }

  function retry() {
    setFailure(null)
    setCode('')
    setPhase('scanning')
    setAttempt((n) => n + 1)
  }

  if (phase === 'done') {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <p
          className="font-[family-name:var(--heading)] text-5xl font-extrabold tracking-[-1.5px]"
          style={{ color: 'var(--status-present)' }}
        >
          Marked
        </p>
        <p className="mt-3 text-card-foreground">
          You are present for {courseCode}, {courseTitle}.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">Back to courses</Link>
        </Button>
      </div>
    )
  }

  if (phase === 'failed' && failure) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <p
          className="font-[family-name:var(--heading)] text-4xl font-extrabold tracking-[-1.2px]"
          style={{ color: 'var(--status-absent)' }}
        >
          Not marked
        </p>
        <p className="mt-3 text-card-foreground">
          {failureLabels[failure] ?? 'Something went wrong. Try again.'}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          {retryable.has(failure) && <Button onClick={retry}>Try again</Button>}
          <Button asChild variant="outline">
            <Link href="/">Back to courses</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-black">
        <video
          ref={videoRef}
          className="aspect-square w-full object-cover"
          muted
          playsInline
        />
      </div>

      {phase === 'sending' && <p className="mt-3 text-center text-sm">Marking you present…</p>}

      {cameraBlocked && (
        <p className="mt-3 text-sm text-muted-foreground">
          The camera is unavailable, so use the code shown next to the QR.
        </p>
      )}

      {zoomRange && (
        <label className="mt-4 block">
          <span className="meta">Zoom</span>
          <input
            type="range"
            min={zoomRange.min}
            max={zoomRange.max}
            step={zoomRange.step}
            defaultValue={zoomRange.min}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
        </label>
      )}

      {codeOpen ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-5">
          <p className="meta">Can&rsquo;t scan? Type the code on screen</p>
          <div className="mt-3 flex gap-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="6 characters"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2.5 font-mono text-xl tracking-[0.15em] text-card-foreground outline-none focus:border-ring"
            />
            <Button
              disabled={code.length < 6 || phase === 'sending'}
              onClick={() => submit(code)}
              className="px-6"
            >
              Mark me
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCodeOpen(true)}
          className="mt-4 text-sm text-primary underline underline-offset-4"
        >
          Enter the code instead
        </button>
      )}
    </>
  )
}
