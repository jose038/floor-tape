import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/push/subscribe')({
  server: {
    handlers: {
      GET: async () => {
        const { vapidPublicKey } = await import('../server/notify')
        return Response.json({ publicKey: vapidPublicKey() })
      },
      POST: async ({ request }) => {
        const { handleSubscribe } = await import('../server/notify')
        return handleSubscribe(request)
      },
      DELETE: async ({ request }) => {
        const { handleUnsubscribe } = await import('../server/notify')
        return handleUnsubscribe(request)
      },
    },
  },
})
