import type { LucideIcon } from 'lucide-react'

export default function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="max-w-xl rounded-lg border border-dashed border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div>
          <p className="font-bold text-card-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{children}</p>
        </div>
      </div>
    </div>
  )
}
