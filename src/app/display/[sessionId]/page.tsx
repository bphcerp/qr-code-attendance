import ProjectorDisplay from '@/components/ProjectorDisplay'

export const dynamic = 'force-dynamic'

export default async function DisplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ dt?: string }>
}) {
  const { sessionId } = await params
  const { dt } = await searchParams

  return <ProjectorDisplay sessionId={sessionId} displayToken={dt ?? null} />
}
