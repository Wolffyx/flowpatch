/**
 * Unit tests for ID generation utilities.
 */
import { describe, it, expect } from 'vitest'
import { generateId, cryptoRandomId, cryptoId } from './id'

describe('generateId', () => {
  it('should generate a 32-character hex string', () => {
    const id = generateId()
    expect(id).toHaveLength(32)
  })

  it('should only contain hexadecimal characters', () => {
    const id = generateId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('should generate unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId())
    }
    // All 1000 IDs should be unique
    expect(ids.size).toBe(1000)
  })

  it('should not return the same ID twice in succession', () => {
    const id1 = generateId()
    const id2 = generateId()
    expect(id1).not.toBe(id2)
  })
})

describe('cryptoRandomId (deprecated alias)', () => {
  it('should be an alias for generateId', () => {
    expect(cryptoRandomId).toBe(generateId)
  })

  it('should generate valid IDs', () => {
    const id = cryptoRandomId()
    expect(id).toHaveLength(32)
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('cryptoId (deprecated alias)', () => {
  it('should be an alias for generateId', () => {
    expect(cryptoId).toBe(generateId)
  })

  it('should generate valid IDs', () => {
    const id = cryptoId()
    expect(id).toHaveLength(32)
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })
})
