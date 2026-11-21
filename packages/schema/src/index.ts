import { z } from 'zod'

// Placeholder: real schemas arrive in T3.
export const venueIdSchema = z.string().min(1)
export type VenueId = z.infer<typeof venueIdSchema>
