import { z } from 'zod'

const name = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}][\p{L}\p{N} '\-]*$/u, 'Nur Buchstaben, Zahlen, Leerzeichen, Apostroph und Bindestrich erlaubt')
const category = z.string().trim().min(1).max(40).nullable()
export const createCodenameSchema = z.object({ name, category: category.optional() }).strict()
export const updateCodenameSchema = z.object({ name: name.optional(), category: category.optional(), retired: z.boolean().optional(), retiredReason: z.string().trim().max(200).nullable().optional() }).strict().refine(value => Object.keys(value).length > 0, 'Keine Änderungen angegeben')
export const assignCodenameSchema = z.object({ agentId: z.string().trim().min(1), note: z.string().trim().max(5000).optional(), force: z.boolean().optional() }).strict()
export const releaseCodenameSchema = z.object({ retire: z.boolean().optional(), note: z.string().trim().max(5000).optional() }).strict()
export const codenameQuerySchema = z.object({
  search: z.string().trim().max(80).default(''),
  status: z.enum(['free', 'assigned', 'retired']).optional(),
  category: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
})
