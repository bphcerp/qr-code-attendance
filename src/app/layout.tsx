import type { Metadata, Viewport } from 'next'
import { Montserrat, Manrope, IBM_Plex_Mono } from 'next/font/google'
import { ThemeProvider } from '@/context/ThemeContext'
import './globals.css'

const montserrat = Montserrat({
  variable: '--font-montserrat',
  weight: ['700', '800', '900'],
  subsets: ['latin'],
})

const manrope = Manrope({
  variable: '--font-manrope',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
})

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  weight: ['400', '500'],
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Attendance',
  description: 'QR attendance for BITS Pilani',
  appleWebApp: { capable: true, title: 'Attendance' },
}

export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: '#b45309',
}

// SU Connect sets data-theme in a useEffect, which is fine for a client-only
// Vite build. Server-rendered HTML arrives before any effect runs, so doing the
// same here would paint the default palette and repaint on hydration -- a
// visible flash on every cold load. This runs before first paint instead.
const themeBootstrap = `
try {
  var m = localStorage.getItem('theme-mode');
  var p = localStorage.getItem('theme-palette');
  if (m !== 'light' && m !== 'dark') m = 'light';
  if (['crimson','navy','amber','sky'].indexOf(p) === -1) p = 'amber';
  document.documentElement.setAttribute('data-theme', p + '-' + m);
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${montserrat.variable} ${manrope.variable} ${plexMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
