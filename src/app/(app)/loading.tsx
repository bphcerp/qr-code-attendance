export default function AppLoading() {
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center gap-3 px-4 py-2 sm:min-h-20 sm:px-6">
          <div className="mr-3 h-5 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
          <div className="ml-auto h-8 w-8 animate-pulse rounded-md bg-muted" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">
        <div className="my-8 h-9 w-48 animate-pulse rounded bg-muted" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-6">
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-4 w-32 animate-pulse rounded bg-muted" />
              <div className="mt-4 h-8 w-14 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-24 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
