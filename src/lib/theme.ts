export const THEME_COLORS = {
  'crimson-light': '#fdf9f8',
  'crimson-dark': '#1d1b1a',
  'navy-light': '#f8f9fd',
  'navy-dark': '#191c24',
  'amber-light': '#fdf9f2',
  'amber-dark': '#1e1b17',
  'sky-light': '#f7fafc',
  'sky-dark': '#181d20',
} as const

export function themeColorFor(theme: string) {
  return THEME_COLORS[theme as keyof typeof THEME_COLORS] ?? THEME_COLORS['amber-light']
}
