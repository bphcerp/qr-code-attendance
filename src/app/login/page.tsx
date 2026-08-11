import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { signInWithGoogle } from '@/app/actions'
import LoginSubmit from '@/components/LoginSubmit'

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
          <LoginSubmit />
        </form>

        <p className="mt-4 text-sm text-muted-foreground">
          Only {domains.join(', ') || 'approved institute'} addresses can sign in.
        </p>

        {/* DPDP 2023 makes location personal data, so what gets collected is
            stated at the door instead of in a policy page nobody opens. */}
        <div className="mt-6 border-t border-border pt-5">
          <p className="meta">What this app records</p>
          <ul className="mt-3 mb-0 list-none space-y-2 p-0 text-sm text-muted-foreground">
            <li>A device fingerprint and a device cookie, so one phone can&rsquo;t mark two people.</li>
            <li>Your IP address and the time of every mark.</li>
            <li>
              Coarse location when you scan, if you allow it. Refusing does not block you &mdash;
              it is recorded as a flag your instructor can see.
            </li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Location and IP are purged one semester after the class. The attendance itself is kept.
          </p>
        </div>
      </div>
    </main>
  )
}
