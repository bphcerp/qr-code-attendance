'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import Spinner from '@/components/ui/spinner'

export default function LoginSubmit() {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      size="lg"
      className="h-12 w-full text-base"
      disabled={pending}
      aria-busy={pending}
    >
      {pending && <Spinner />}
      {pending ? 'Opening Google…' : 'Continue with Google'}
    </Button>
  )
}
