'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Mode = 'light' | 'dark'
export type Palette = 'crimson' | 'navy' | 'amber' | 'sky'

type ThemeContextValue = {
  mode: Mode
  palette: Palette
  setMode: (mode: Mode) => void
  setPalette: (palette: Palette) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// Initial state has to match what the bootstrap script in layout.tsx already
// wrote to the DOM, so these read localStorage lazily rather than defaulting.
// On the server there is no localStorage, hence the typeof check.
function readMode(): Mode {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem('theme-mode')
  if (stored === 'light' || stored === 'dark') return stored
  return 'light'
}

function readPalette(): Palette {
  if (typeof window === 'undefined') return 'amber'
  const stored = localStorage.getItem('theme-palette')
  if (stored === 'crimson' || stored === 'navy' || stored === 'amber' || stored === 'sky') {
    return stored
  }
  return 'amber'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(readMode)
  const [palette, setPalette] = useState<Palette>(readPalette)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', `${palette}-${mode}`)
  }, [mode, palette])

  useEffect(() => {
    localStorage.setItem('theme-mode', mode)
  }, [mode])

  useEffect(() => {
    localStorage.setItem('theme-palette', palette)
  }, [palette])

  return (
    <ThemeContext.Provider value={{ mode, palette, setMode, setPalette }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
