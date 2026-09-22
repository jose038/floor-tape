import { createFileRoute } from '@tanstack/react-router'

/** Liveness only. Must not open the database or ingest filings. */
export const Route = createFileRoute('/health')({
  server: {
    handlers: {
      GET: () => new Response('ok\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
    },
  },
})
