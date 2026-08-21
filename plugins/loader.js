/**
 * PLUGIN LOADER.
 *
 * Every file in `plugins/` (except this one) is expected to default-export
 * a plugin function. A plugin receives a `ctx` object and registers whatever
 * handlers / commands it needs on the client.
 *
 * Plugin contract:
 *
 *   export default function myPlugin(ctx) { ... }
 *
 *   ctx = {
 *     client,   // the zapo WaClient
 *     logger,   // the logger
 *     config    // { prefix, name, ... }
 *   }
 *
 * Plugins are loaded with dynamic `import()` so adding a new feature is just
 * dropping a new file into this folder — no changes to the entry point needed.
 */
import { readdirSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * @param {object}   deps
 * @param {import('zapo-js').WaClient} deps.client
 * @param {import('zapo-js').Logger}   deps.logger
 * @param {object}   [deps.config]
 * @returns {Promise<string[]>} names of the plugins that loaded.
 */
export async function loadPlugins({ client, logger, config = {} }) {
  const entries = readdirSync(__dirname, { withFileTypes: true })
  const jsFiles = entries
    .filter((e) => e.isFile() && e.name !== 'loader.js' && extname(e.name) === '.js')
    .map((e) => e.name)
    .sort()

  const loaded = []

  for (const file of jsFiles) {
    const fileUrl = new URL(`./${file}`, import.meta.url).href
    try {
      const mod = await import(fileUrl)
      const plugin = mod.default
      if (typeof plugin !== 'function') {
        logger.warn({ file }, 'plugin skipped: no default-exported function')
        continue
      }
      const name = plugin.name || file.replace(/\.js$/, '')
      await plugin({ client, logger, config })
      loaded.push(name)
      logger.info({ name, file }, 'plugin loaded')
    } catch (error) {
      logger.error({ file, message: error?.message }, 'plugin failed to load')
    }
  }

  return loaded
}
