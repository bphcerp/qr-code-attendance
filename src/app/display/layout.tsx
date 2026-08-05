// data-display opts this route out of the palette system entirely (see
// globals.css). Set before paint rather than in an effect, so the projector
// never flashes a themed frame on the way to white.
const forceLight = `document.documentElement.setAttribute('data-display','')`

export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: forceLight }} />
      {children}
    </>
  )
}
