import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { signInWithGoogle } from '@/app/actions'
import LoginSubmit from '@/components/LoginSubmit'

export default async function LoginPage() {
  const session = await auth()
  if (session?.user?.email) redirect('/')

  return (
    <main className="flex flex-1 items-center justify-center p-5">
      <div className="w-full max-w-[440px] rounded-lg border border-border bg-card p-6">
        <h1 className="page-title">Attendance</h1>
        <form action={signInWithGoogle} className="mt-6">
          <LoginSubmit />
        </form>
      </div>
    </main>
  )
}
