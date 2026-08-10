import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { signInWithGoogle } from '@/app/actions'
import { Button } from '@/components/ui/button'

const domains = (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean)

export default async function LoginPage() {
  const session = await auth()
  if (session?.user?.email) redirect('/')

  return (
    <main className="flex flex-1 items-center justify-center p-5">
      <div className="w-full max-w-[440px] rounded-lg border border-border bg-card p-6">
        <h1 className="page-title">Attendance</h1>
        <p className="mt-2 mb-6">Sign in with your BITS Google account.</p>

        <form action={signInWithGoogle}>
          <Button type="submit" size="lg" className="h-12 w-full text-base">
            Continue with Google
          </Button>
        </form>

        <p className="mt-4 text-sm text-muted-foreground">
          Only {domains.join(', ') || 'approved institute'} addresses can sign in.
        </p>

        <div className="mt-6 border-t border-border pt-5">
          <p className="meta">What this app records</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Which class you were marked present for, and when. Nothing else.
          </p>
        </div>
      </div>
    </main>
  )
}
