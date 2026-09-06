'use client'

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { deviceFingerprint } from '@/lib/fingerprint'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/spinner'
import { CODE_LENGTH } from '@/lib/tokenFormat'

type Phase = 'scanning' | 'sending' | 'done' | 'failed'

type Geo = { lat?: number; lng?: number; accuracy?: number; denied?: boolean }

type ZoomRange = { min: number; max: number; step: number }

function rubberband(value: number, min: number, max: number) {
  const dimension = Math.max(max - min, 1)
  const resistance = 0.18
  if (value < min) {
    const overshoot = min - value
    return min - (overshoot * dimension * resistance) / (dimension + resistance * overshoot)
  }
  if (value > max) {
    const overshoot = value - max
    return max + (overshoot * dimension * resistance) / (dimension + resistance * overshoot)
  }
  return value
}

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

// Retrying only helps when the token itself was the problem, or when the server
// hit a transient error. Everything else is settled -- re-scanning an
// already-marked student just produces the same 409. `internal_error` is the 500
// body: it must offer a retry so a hiccup mid-class isn't a dead end with no way
// forward.
const retryable = new Set([
  'invalid_token',
  'token_expired',
  'bad_request',
  'unknown',
  'internal_error',
])

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
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null)

  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>('scanning')
  const [failure, setFailure] = useState<string | null>(null)
  const [cameraBlocked, setCameraBlocked] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [code, setCode] = useState('')
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null)
  const [zoom, setZoom] = useState(1)
  const [cssZoom, setCssZoom] = useState(1)
  const [pinching, setPinching] = useState(false)

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
          navigator.vibrate?.(30)
          setPhase('done')
          return
        }

        const body = await res.json().catch(() => ({}))
        setFailure(body.error ?? 'unknown')
      } catch {
        setFailure('unknown')
      }
      navigator.vibrate?.([35, 50, 35])
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
          setZoom(capabilities.zoom.min)
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

  function updateZoom(value: number, allowRubberband = false) {
    if (zoomRange) {
      const next = Math.min(zoomRange.max, Math.max(zoomRange.min, value))
      setZoom(next)
      applyZoom(next)
      const softened = allowRubberband
        ? rubberband(value, zoomRange.min, zoomRange.max)
        : next
      const range = Math.max(zoomRange.max - zoomRange.min, 1)
      setCssZoom(Math.min(1.04, Math.max(0.96, 1 + (softened - next) / (range * 4))))
      return
    }

    setCssZoom(allowRubberband ? rubberband(value, 1, 3) : Math.min(3, Math.max(1, value)))
  }

  function pointerDistance() {
    const points = [...pointersRef.current.values()]
    if (points.length < 2) return 0
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setPinching(true)
    if (pointersRef.current.size === 2) {
      pinchRef.current = {
        distance: pointerDistance(),
        zoom: zoomRange ? zoom : cssZoom,
      }
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size !== 2 || !pinchRef.current) return

    const range = zoomRange ? zoomRange.max - zoomRange.min : 2
    const delta = (pointerDistance() - pinchRef.current.distance) / event.currentTarget.clientWidth
    updateZoom(pinchRef.current.zoom + delta * range, true)
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId)
    pinchRef.current = null
    if (pointersRef.current.size === 0) {
      setPinching(false)
      if (zoomRange) setCssZoom(1)
      else updateZoom(cssZoom)
    }
  }

  function retry() {
    setFailure(null)
    setCode('')
    setPhase('scanning')
    setAttempt((n) => n + 1)
  }

  if (phase === 'done') {
    return (
      <div className="animate-in fade-in-0 rounded-lg border border-border bg-card p-6 text-center duration-150">
        <p
          className="stat text-[3rem]"
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
      <div className="animate-in fade-in-0 rounded-lg border border-border bg-card p-6 text-center duration-150">
        <p
          className="stat"
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
      <div
        className="relative touch-pan-y overflow-hidden rounded-lg border border-border bg-black"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <video
          ref={videoRef}
          aria-label={`Camera preview for scanning ${courseCode}`}
          className={`aspect-square w-full object-cover ${pinching ? '' : 'transition-transform duration-150'}`}
          style={{ transform: `scale(${cssZoom})` }}
          muted
          playsInline
        />
        <div className="scan-reticle" data-detected={phase === 'sending'} aria-hidden="true" />
      </div>

      {phase === 'scanning' && !cameraBlocked && (
        <p className="mt-3 text-center text-sm text-muted-foreground">
          Align the projected QR inside the frame. Pinch to zoom.
        </p>
      )}

      {phase === 'sending' && (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 flex items-center justify-center gap-2 text-center text-sm"
        >
          <Spinner /> Marking you present…
        </p>
      )}

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
            value={zoom}
            aria-label="Camera zoom"
            aria-valuetext={`${zoom.toFixed(1)} times`}
            onChange={(e) => updateZoom(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
        </label>
      )}

      {codeOpen ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-5">
          <label htmlFor="attendance-code" className="meta">
            Can&rsquo;t scan? Type the code on screen
          </label>
          <div className="mt-3 flex gap-3">
            <input
              id="attendance-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder={`${CODE_LENGTH} characters`}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2.5 font-mono text-xl tracking-[0.15em] text-card-foreground outline-none focus:border-ring"
            />
            <Button
              disabled={code.length !== CODE_LENGTH || phase === 'sending'}
              onClick={() => submit(code)}
              className="px-6"
            >
              Mark me
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="link"
          onClick={() => setCodeOpen(true)}
          className="mt-4 px-0"
        >
          Enter the code instead
        </Button>
      )}
    </>
  )
}
