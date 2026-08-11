'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LibraryBig, LogOut, QrCode } from 'lucide-react'
import { signOutAndReturnToLogin } from '@/app/actions'
import ThemeMenu from './ThemeMenu'
import { Button } from '@/components/ui/button'

export default function AppShell({
  name,
  enrolled,
  children,
}: {
  name: string
  enrolled: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Scan follows enrolment rather than role. Faculty enrolled in a course are
  // rare but real, and role alone would hide the only screen they need.
  const nav = [{ href: '/', label: 'Courses', icon: LibraryBig }]
  if (enrolled) nav.push({ href: '/scan', label: 'Scan', icon: QrCode })

  return (
    <>
      <header className="app-header sticky top-0 z-20 bg-background/80 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center gap-3 px-4 py-2 sm:min-h-20 sm:px-6">
          <Link
            href="/"
            aria-label="Attendance courses"
            className="mr-3 rounded-sm font-[family-name:var(--heading)] text-[17px] font-extrabold tracking-[-0.5px] text-card-foreground transition-opacity hover:opacity-75"
          >
            Attendance
          </Link>

          {nav.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-bold text-accent-foreground transition-colors duration-150'
                    : 'flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-colors duration-150 hover:bg-accent'
                }
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            )
          })}

          <div className="ml-auto flex items-center gap-2">
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
