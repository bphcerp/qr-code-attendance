'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

type Payload = {
  token: string
  code: string
  nextRotationAt: string
  serverTime: string
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
}: {
  sessionId: string
  displayToken: string | null
}) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(
    displayToken ? null : 'display_token_missing',
  )
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

  useEffect(() => {
    if (!payload) return
    // Level L keeps the module count down, which is the whole game at this
    // distance -- bigger squares beat redundancy the QR spec adds for damaged
    // prints, and a projected code is not a damaged print.
    QRCode.toString(payload.token, {
      type: 'svg',
      errorCorrectionLevel: 'L',
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setSvg)
  }, [payload])

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-8 text-center">
        <p className="text-5xl font-extrabold text-black">Display stopped</p>
        <p className="text-2xl text-neutral-600">{errorLabels[error] ?? 'Something went wrong.'}</p>
        <p className="text-xl text-neutral-500">Generate a new display link from the course page.</p>
      </main>
    )
  }

  if (!payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-3xl text-neutral-500">Starting…</p>
      </main>
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
