import { describe, expect, it } from 'vitest'
import { venueIdSchema } from './index'

describe('venueIdSchema', () => {
  // Contract: venue ids are non-empty strings.
  it('accepts a non-empty string and rejects an empty one', () => {
    expect(venueIdSchema.safeParse('shibuya-o-east').success).toBe(true)
    expect(venueIdSchema.safeParse('').success).toBe(false)
  })
})
