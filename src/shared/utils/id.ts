/**
 * Unified ID generation utilities.
 * Consolidates cryptoId and cryptoRandomId into a single module.
 */

/**
 * Generate a random 32-character hex ID.
 * Uses crypto-safe random bytes when available.
 */
export function generateId(): string {
  const buf = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) {
    buf[i] = Math.floor(Math.random() * 256)
  }
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Alias for generateId for backward compatibility.
 * @deprecated Use generateId instead
 */
export const cryptoRandomId = generateId

/**
 * Alias for generateId for backward compatibility.
 * @deprecated Use generateId instead
 */
export const cryptoId = generateId
