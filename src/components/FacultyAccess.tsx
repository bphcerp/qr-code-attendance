'use client'

import { useActionState } from 'react'
import { UserPlus, X } from 'lucide-react'
import {
  grantFacultyAccess,
  revokeFacultyAccess,
  type FacultyAccessState,
} from '@/app/adminActions'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/spinner'

const initialState: FacultyAccessState = {}

export default function GrantFacultyForm() {
  const [state, action, pending] = useActionState(grantFacultyAccess, initialState)

  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-5 shadow-[var(--shadow)]">
      <div>
        <h2>Give a professor access</h2>
        <p className="text-sm text-muted-foreground">
          They can add their own courses and take attendance. An address that has never signed
          in is held until it does &mdash; the access lands on the Google account, not on the
          address.
        </p>
      </div>

      <form
        action={action}
        className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      >
        <label className="block">
          <span className="text-sm font-medium text-card-foreground">Institute email</span>
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            spellCheck={false}
            placeholder="name@hyderabad.bits-pilani.ac.in"
            aria-invalid={Boolean(state.error)}
            aria-describedby={state.error ? 'faculty-email-error' : undefined}
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-card-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
          />
        </label>

        <Button type="submit" className="h-10 sm:px-5" disabled={pending}>
          {pending ? <Spinner /> : <UserPlus />}
          {pending ? 'Adding…' : 'Give access'}
        </Button>

        {state.error && (
          <p id="faculty-email-error" role="alert" className="text-sm text-destructive sm:col-span-2">
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

export function RevokeAccessForm({ email, label }: { email: string; label: string }) {
  const [state, action, pending] = useActionState(revokeFacultyAccess, initialState)

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="email" value={email} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? <Spinner /> : <X />}
        {label}
      </Button>
      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      )}
    </form>
  )
}
