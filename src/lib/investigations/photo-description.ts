import { z } from 'zod'

export const photoDescriptionSchema = z.string().trim().max(5000, 'Die Beschreibung darf höchstens 5000 Zeichen enthalten.').nullable().transform(value => value || null)
