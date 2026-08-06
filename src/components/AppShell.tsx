'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { House, LogOut, QrCode } from 'lucide-react'
import { signOutAndReturnToLogin } from '@/app/actions'
import ThemeMenu from './ThemeMenu'
import { Button } from '@/components/ui/button'

export default function AppShell({
  name,
  role,
  enrolled,
  children,
}: {
  name: string
  role: string
  enrolled: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Scan follows enrolment rather than role. Faculty enrolled in a course are
  // rare but real, and role alone would hide the only screen they need.
  const nav = [{ href: '/', label: role === 'student' ? 'Home' : 'Courses', icon: House }]
  if (enrolled) nav.push({ href: '/scan', label: 'Scan', icon: QrCode })

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1 px-4 sm:h-16 sm:px-6">
          <span className="mr-3 font-[family-name:var(--heading)] text-[17px] font-extrabold tracking-[-0.5px] text-card-foreground">
            Attendance
          </span>

          {nav.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? 'flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-bold text-accent-foreground'
                    : 'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-accent'
                }
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            )
          })}

          <div className="ml-auto flex items-center gap-1">
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
