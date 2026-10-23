import type { PrismaClient } from '@/generated/prisma/client'

// Derive the delegate type from the client itself so this stays correct
// regardless of the Prisma generator (no per-model module paths required).
type UserGroupDelegate = PrismaClient['userGroup']

export function userGroupDelegate(client: PrismaClient): UserGroupDelegate {
  return (client as unknown as { userGroup: UserGroupDelegate }).userGroup
}
