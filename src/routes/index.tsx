import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Dashboard } from '../components/dashboard'
import { getDashboard } from '../lib/functions'

export const Route = createFileRoute('/')({
  validateSearch: z.object({ view: z.enum(['tunnels', 'applications', 'policies', 'settings']).catch('tunnels').default('tunnels') }),
  loader: async () => {
    try { return { data: await getDashboard(), error: '' } }
    catch (error) { return { data: null, error: error instanceof Error ? error.message : 'Couldn’t reach Cloudflare.' } }
  },
  component: DashboardPage,
})

function DashboardPage() {
  const { data, error } = Route.useLoaderData()
  const { view } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <Dashboard initialData={data} initialError={error} view={view} onViewChange={(next) => navigate({ search: { view: next } })} />
}
