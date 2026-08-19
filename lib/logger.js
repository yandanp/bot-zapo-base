/**
 * Logger setup.
 *
 * Uses zapo's PinoLogger when `pino` is installed, falling back to the
 * zero-dependency ConsoleLogger otherwise. Level is read from LOG_LEVEL.
 */
import { ConsoleLogger, createPinoLogger } from 'zapo-js'

/**
 * @returns {Promise<import('zapo-js').Logger>}
 */
export async function createLogger() {
  const level = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  try {
    return await createPinoLogger({ level, pretty: true })
  } catch {
    // pino not available – fall back to the built-in console logger.
    return new ConsoleLogger(level)
  }
}
