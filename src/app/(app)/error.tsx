'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="my-12 max-w-xl rounded-lg border border-border bg-card p-6">
      <p className="meta">Something went wrong</p>
      <h1 className="page-title mt-2">We couldn’t load this screen</h1>
      <p className="mt-3 text-muted-foreground">
        Try loading it again. If that does not work, return to your courses.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={retry}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Back to courses</Link>
        </Button>
      </div>
    </div>
  )
}
