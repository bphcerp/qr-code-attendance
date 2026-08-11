import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="my-12 max-w-xl rounded-lg border border-border bg-card p-6">
      <p className="meta">Not found</p>
      <h1 className="page-title mt-2">That page isn’t available</h1>
      <p className="mt-3 text-muted-foreground">
        It may have been removed, or you may not have access to that course.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Back to courses</Link>
      </Button>
    </div>
  )
}
