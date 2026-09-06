'use client'

import { useActionState } from 'react'
import { Smartphone } from 'lucide-react'
import { releaseStudentDevice, type DeviceReleaseState } from '@/app/courseActions'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/spinner'

const initialState: DeviceReleaseState = {}

export default function DeviceRelease({ courseId }: { courseId: string }) {
  const [state, action, pending] = useActionState(releaseStudentDevice, initialState)

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border p-5">
        <h2 className="font-bold text-card-foreground">Device binding</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each student marks from one registered phone. Release it if they have a new phone, cleared
          their browser, or got stuck — their next mark registers whatever device they scan on.
        </p>
      </div>

      <form
        action={action}
        className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      >
        <input type="hidden" name="courseId" value={courseId} />
        <label className="block">
          <span className="text-sm font-medium text-card-foreground">Release a student’s device</span>
          <input
            name="student"
            type="text"
            required
            maxLength={254}
            autoComplete="off"
            spellCheck={false}
            placeholder="Student email or ID"
            aria-invalid={Boolean(state.error)}
            aria-describedby={state.error ? 'device-release-error' : undefined}
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-card-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
          />
          <span className="mt-1.5 block text-xs text-muted-foreground">
            Only affects students on this course. The binding is released immediately.
          </span>
        </label>
        <Button type="submit" variant="outline" className="h-10 sm:px-5" disabled={pending}>
          {pending ? <Spinner /> : <Smartphone />}
          {pending ? 'Releasing…' : 'Release device'}
        </Button>
        {state.error && (
          <p id="device-release-error" role="alert" className="text-sm text-destructive sm:col-span-2">
            {state.error}
          </p>
        )}
        {state.notice && (
          <p role="status" className="text-sm text-muted-foreground sm:col-span-2">
            {state.notice}
          </p>
        )}
      </form>
    </section>
  )
}
