import { LoaderCircle } from 'lucide-react'

export default function Spinner({ className = 'size-4' }: { className?: string }) {
  return <LoaderCircle aria-hidden="true" className={`${className} animate-spin motion-reduce:animate-none`} />
}
