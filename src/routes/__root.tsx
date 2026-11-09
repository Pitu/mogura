import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import '../styles.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Mogura · Cloudflare dashboard' },
      { name: 'theme-color', content: '#101115' },
    ],
    links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
  }),
  component: () => (
    <html lang="en">
      <head><HeadContent /></head>
      <body><Outlet /><Scripts /></body>
    </html>
  ),
  notFoundComponent: () => <main className="standalone"><h1>Page not found</h1><a href="/">Back to tunnels</a></main>,
  errorComponent: ({ error, reset }) => <main className="standalone"><h1>Couldn’t load the dashboard</h1><p>{error instanceof Error ? error.message : 'An unexpected error occurred.'}</p><button onClick={reset}>Try again</button></main>,
})
