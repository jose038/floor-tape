import { definePlugin } from 'nitro'
import { armProcessRecheck } from './notify'

/** Runs when the server process starts, before any page request. */
export default definePlugin((nitroApp) => {
  const handle = armProcessRecheck()
  nitroApp.hooks.hook('close', () => {
    handle.stop()
  })
})
