import { createFileRoute } from '@tanstack/react-router'

/** Woken by Cloud Scheduler about every 2 hours. The service stays scaled to zero between checks. */
export const Route = createFileRoute('/internal/poll')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handlePoll } = await import('../server/notify')
        return handlePoll(request)
      },
    },
  },
})
