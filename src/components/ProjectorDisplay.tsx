'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import Spinner from '@/components/ui/spinner'

type Payload = {
  token: string
  code: string
  nextRotationAt: string
  serverTime: string
}

// Seconds up to a minute, then m:ss -- an announced-code session runs on a
// rotation of minutes, and "changes in 143" is not a thing anyone can act on.
function formatCountdown(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const errorLabels: Record<string, string> = {
  display_token_missing: 'This link is missing its display key.',
  display_token_invalid: 'This display link is not valid.',
  display_token_revoked: 'This display link was revoked.',
  display_token_expired: 'This display link has expired.',
  display_token_wrong_device: 'This link is already in use on another device.',
  session_closed: 'The session has ended.',
  not_found: 'Session not found.',
}

export default function ProjectorDisplay({
  sessionId,
  displayToken,
  variant = 'fullscreen',
  onToken,
}: {
  sessionId: string
  displayToken: string | null
  // 'code' is for classes held somewhere with nothing to project onto -- the
  // ground, mostly. The lecturer reads the six characters out and students type
  // them in, so the code is the whole screen and the QR is a courtesy for
  // whoever is standing close enough to use it.
  variant?: 'fullscreen' | 'embedded' | 'code'
  onToken?: (token: string) => void
}) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(
    displayToken ? null : 'display_token_missing',
  )
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  // the podium PC's clock is not to be trusted -- every response carries the
  // server's time and this is the difference we correct by
  const clockOffset = useRef(0)

  useEffect(() => {
    if (!displayToken) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/sessions/${sessionId}/token?dt=${encodeURIComponent(displayToken)}`,
          { cache: 'no-store' },
        )
        if (cancelled) return

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          // Stop polling on a hard rejection. A frozen QR left on screen is
          // worse than a blank one: it still looks live from the back of the
          // hall while every scan against it fails.
          setError(body.error ?? 'unknown')
          setPayload(null)
          return
        }

        const data: Payload = await res.json()
        clockOffset.current = Date.parse(data.serverTime) - Date.now()
        setPayload(data)
        setError(null)

        const delay = Date.parse(data.nextRotationAt) - (Date.now() + clockOffset.current)
        timer = setTimeout(tick, Math.max(400, delay + 120))
      } catch {
        if (cancelled) return
        // network blip rather than a rejection -- keep trying, the projector
        // shouldn't die because one request dropped
        timer = setTimeout(tick, 1500)
      }
    }

    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sessionId, displayToken])

  // Counted down on its own interval rather than off the poll, because reading
  // a code out to a field of people needs a few seconds' warning before it
  // changes underneath them -- otherwise half the row types the previous one.
  useEffect(() => {
    if (!payload) return
    const target = Date.parse(payload.nextRotationAt)
    const update = () =>
      setSecondsLeft(Math.max(0, Math.round((target - (Date.now() + clockOffset.current)) / 1000)))
    update()
    const timer = setInterval(update, 500)
    return () => clearInterval(timer)
  }, [payload])

  useEffect(() => {
    if (!payload) return
    onToken?.(payload.token)
    // Level L keeps the module count down, which is the whole game at this
    // distance -- bigger squares beat redundancy the QR spec adds for damaged
    // prints, and a projected code is not a damaged print.
    QRCode.toString(payload.token, {
      type: 'svg',
      errorCorrectionLevel: 'L',
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setSvg)
  }, [payload, onToken])

  if (error) {
    return (
      <div
        className={
          variant !== 'fullscreen'
            ? 'flex min-h-[min(68vh,640px)] flex-col items-center justify-center gap-3 rounded-lg bg-white p-6 text-center'
            : 'flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-8 text-center'
        }
      >
        <p
          className={
            variant !== 'fullscreen'
              ? 'text-2xl font-extrabold text-black'
              : 'text-5xl font-extrabold text-black'
          }
        >
          Display stopped
        </p>
        <p
          className={
            variant !== 'fullscreen' ? 'text-base text-neutral-600' : 'text-2xl text-neutral-600'
          }
        >
          {errorLabels[error] ?? 'Something went wrong.'}
        </p>
        <p
          className={
            variant !== 'fullscreen' ? 'text-sm text-neutral-500' : 'text-xl text-neutral-500'
          }
        >
          Generate a new display from the course page.
        </p>
      </div>
    )
  }

  if (!payload) {
    return (
      <div
        className={
          variant !== 'fullscreen'
            ? 'flex min-h-[min(68vh,640px)] items-center justify-center rounded-lg bg-white'
            : 'flex min-h-screen items-center justify-center bg-white'
        }
      >
        <p
          role="status"
          aria-live="polite"
          className={
            variant !== 'fullscreen'
              ? 'flex items-center gap-3 text-lg text-neutral-600'
              : 'flex items-center gap-3 text-3xl text-neutral-600'
          }
        >
          <Spinner className="size-8" /> Starting…
        </p>
      </div>
    )
  }

  if (variant === 'code') {
    return (
      <div className="flex min-h-[min(68vh,640px)] flex-col items-center justify-center gap-6 rounded-lg bg-white p-4 sm:p-6">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-neutral-500">
            Read this out
          </p>
          {/* Always one line -- the six-character code is read out at arm's
              length, so it scales with the viewport to fit rather than wrapping,
              capped so it doesn't get absurd on a wide projector. */}
          <p className="mt-3 whitespace-nowrap font-mono text-[clamp(2.25rem,17vw,6rem)] font-semibold leading-none tracking-[0.1em] text-black">
            {payload.code}
          </p>
          <p
            aria-live="off"
            className={`mt-4 text-lg tabular-nums ${
              secondsLeft !== null && secondsLeft <= 10 ? 'text-black' : 'text-neutral-500'
            }`}
          >
            {secondsLeft === null
              ? ' '
              : secondsLeft <= 0
                ? 'changing…'
                : `changes in ${formatCountdown(secondsLeft)}`}
          </p>
        </div>

        <div className="flex flex-col items-center gap-2 border-t border-neutral-200 pt-5">
          <div
            className="aspect-square w-40 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="text-xs text-neutral-500">or scan, if you are close enough</p>
        </div>
      </div>
    )
  }

  if (variant === 'embedded') {
    return (
      <div className="flex min-h-[min(68vh,640px)] flex-col items-center justify-center gap-6 rounded-lg bg-white p-4 sm:p-6">
        <div
          className="aspect-square w-full max-w-[34rem] [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-neutral-500">
            Can&rsquo;t scan? Enter this code
          </p>
          <p className="mt-2 font-mono text-6xl font-semibold leading-none tracking-[0.08em] text-black sm:text-7xl">
            {payload.code}
          </p>
        </div>
      </div>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-[3vh] bg-white p-[3vh]">
      <div
        className="aspect-square h-[62vh] max-w-[92vw] [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="text-center">
        <p className="text-[2.2vh] font-semibold uppercase tracking-[0.3em] text-neutral-500">
          Can&rsquo;t scan? Enter this code
        </p>
        <p className="font-mono text-[13vh] font-medium leading-none tracking-[0.08em] text-black">
          {payload.code}
        </p>
      </div>
    </main>
  )
}
