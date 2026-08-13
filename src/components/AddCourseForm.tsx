'use client'

import { useActionState } from 'react'
import { Plus } from 'lucide-react'
import { createCourse, type CreateCourseState } from '@/app/courseActions'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/spinner'

const initialState: CreateCourseState = {}
const inputClassName =
  'mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-card-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20'

export default function AddCourseForm({ professorName }: { professorName: string }) {
  const [state, action, pending] = useActionState(createCourse, initialState)

  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-5 shadow-[var(--shadow)]">
      <div>
        <h2>Add a course</h2>
        <p className="text-sm text-muted-foreground">
          It will be assigned to {professorName} from this login.
        </p>
      </div>

      <form action={action} className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto] sm:items-end">
        <label className="block">
          <span className="text-sm font-medium text-card-foreground">Course code</span>
          <input
            name="code"
            type="text"
            required
            minLength={2}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            placeholder="CS F213"
            aria-invalid={Boolean(state.fieldErrors?.code)}
            aria-describedby={state.fieldErrors?.code ? 'course-code-error' : undefined}
            className={`${inputClassName} font-mono uppercase`}
          />
          {state.fieldErrors?.code && (
            <span id="course-code-error" className="mt-1.5 block text-sm text-destructive">
              {state.fieldErrors.code}
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-sm font-medium text-card-foreground">Course name</span>
          <input
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={120}
            autoComplete="off"
            placeholder="Object Oriented Programming"
            aria-invalid={Boolean(state.fieldErrors?.name)}
            aria-describedby={state.fieldErrors?.name ? 'course-name-error' : undefined}
            className={inputClassName}
          />
          {state.fieldErrors?.name && (
            <span id="course-name-error" className="mt-1.5 block text-sm text-destructive">
              {state.fieldErrors.name}
            </span>
          )}
        </label>

        <Button type="submit" className="h-10 sm:px-5" disabled={pending}>
          {pending ? <Spinner /> : <Plus />}
          {pending ? 'Adding…' : 'Add course'}
        </Button>

        {state.error && (
          <p className="text-sm text-destructive sm:col-span-3" role="alert">
            {state.error}
          </p>
        )}
      </form>
    </section>
  )
}
