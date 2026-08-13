'use client'

import { useActionState } from 'react'
import { UserPlus, X } from 'lucide-react'
import {
  addCourseFaculty,
  removeCourseFaculty,
  type CourseFacultyState,
} from '@/app/courseActions'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/spinner'
import StatusChip from '@/components/StatusChip'

type Instructor = {
  email: string
  name: string
  isOwner: boolean
}

const initialState: CourseFacultyState = {}

export default function CourseFacultyManager({
  courseId,
  instructors,
  pending,
  canManage,
}: {
  courseId: string
  instructors: Instructor[]
  pending: { email: string }[]
  canManage: boolean
}) {
  const [state, addAction, adding] = useActionState(addCourseFaculty, initialState)

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border p-5">
        <h2 className="font-bold text-card-foreground">Teaching team</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Active instructors can run sessions and manage the roster; pending addresses join after first sign-in.
        </p>
      </div>

      <ul className="divide-y divide-border">
        {instructors.map((instructor) => (
          <li
            key={instructor.email}
            className="flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div className="min-w-0">
              <p className="font-medium text-card-foreground">
                {instructor.name}
                {instructor.isOwner && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">Owner</span>
                )}
              </p>
              <p className="mt-0.5 font-mono text-xs break-all text-muted-foreground">
                {instructor.email}
              </p>
            </div>
            {canManage && !instructor.isOwner && (
              <RemoveInstructorForm courseId={courseId} email={instructor.email} />
            )}
          </li>
        ))}
        {pending.map((invite) => (
          <li
            key={`pending:${invite.email}`}
            className="flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="font-mono text-sm break-all text-card-foreground">{invite.email}</p>
              <StatusChip tone="pending">Pending</StatusChip>
            </div>
            {canManage && (
              <RemoveInstructorForm courseId={courseId} email={invite.email} label="Cancel" />
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <form
          action={addAction}
          className="grid gap-4 border-t border-border p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        >
          <input type="hidden" name="courseId" value={courseId} />
          <label className="block">
            <span className="text-sm font-medium text-card-foreground">Add professor</span>
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              spellCheck={false}
              placeholder="name@hyderabad.bits-pilani.ac.in"
              aria-invalid={Boolean(state.error)}
              aria-describedby={state.error ? 'course-faculty-error' : undefined}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-card-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
            />
            <span className="mt-1.5 block text-xs text-muted-foreground">
              They can join even if they have not signed in before.
            </span>
          </label>
          <Button type="submit" className="h-10 sm:px-5" disabled={adding}>
            {adding ? <Spinner /> : <UserPlus />}
            {adding ? 'Adding…' : 'Add professor'}
          </Button>
          {state.error && (
            <p id="course-faculty-error" role="alert" className="text-sm text-destructive sm:col-span-2">
              {state.error}
            </p>
          )}
          {state.notice && (
            <p role="status" className="text-sm text-muted-foreground sm:col-span-2">
              {state.notice}
            </p>
          )}
        </form>
      )}
    </section>
  )
}

function RemoveInstructorForm({
  courseId,
  email,
  label = 'Remove',
}: {
  courseId: string
  email: string
  label?: string
}) {
  const [state, action, pending] = useActionState(removeCourseFaculty, initialState)

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="courseId" value={courseId} />
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
