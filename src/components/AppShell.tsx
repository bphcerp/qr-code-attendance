'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LibraryBig, LogOut, QrCode, Users } from 'lucide-react'
import { signOutAndReturnToLogin } from '@/app/actions'
import ThemeMenu from './ThemeMenu'
import { Button } from '@/components/ui/button'

export default function AppShell({
  name,
  enrolled,
  isAdmin,
  children,
}: {
  name: string
  enrolled: boolean
  isAdmin: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Scan follows enrolment rather than role. Faculty enrolled in a course are
  // rare but real, and role alone would hide the only screen they need.
  const nav = [{ href: '/', label: 'Courses', icon: LibraryBig }]
  if (enrolled) nav.push({ href: '/scan', label: 'Scan', icon: QrCode })
  if (isAdmin) nav.push({ href: '/admin/faculty', label: 'Faculty', icon: Users })

  return (
    <>
      <header className="app-header sticky top-0 z-20 bg-background/80 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl min-w-0 items-center gap-1 px-4 py-2 sm:min-h-20 sm:gap-3 sm:px-6">
          <Link
            href="/"
            aria-label="Attendance courses"
            className="mr-1 shrink-0 rounded-sm font-[family-name:var(--heading)] text-[17px] font-extrabold tracking-[-0.5px] text-card-foreground transition-opacity hover:opacity-75 sm:mr-3"
          >
            Attendance
          </Link>

          {nav.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-2 text-sm font-bold text-accent-foreground transition-colors duration-150 sm:px-3.5'
                    : 'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-accent sm:px-3.5'
                }
              >
                <item.icon size={16} />
                {/* Labels drop below sm so the sign-out and theme controls on the
                    right can never be pushed off a phone-width header. */}
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            )
          })}

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">{name}</span>
            <ThemeMenu />
            <form action={signOutAndReturnToLogin}>
              <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
                <LogOut />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">{children}</div>
    </>
  )
}
