const toneColor: Record<string, string> = {
  present: 'var(--status-present)',
  absent: 'var(--status-absent)',
  flagged: 'var(--status-flagged)',
  pending: 'var(--status-pending)',
  live: 'var(--status-resolved)',
  closed: 'var(--status-closed)',
}

export default function StatusChip({
  tone,
  children,
}: {
  tone: keyof typeof toneColor
  children: React.ReactNode
}) {
  return (
    <span
      className="inline-flex items-center rounded-sm px-2.5 py-1 text-xs font-bold whitespace-nowrap text-white"
      style={{ background: toneColor[tone] }}
    >
      {children}
    </span>
  )
}
