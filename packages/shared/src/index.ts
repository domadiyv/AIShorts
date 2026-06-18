export * from './constants';
export * from './schemas';

// Re-export Prisma types and a shared singleton client so every service
// uses one connection pool (important for Neon's connection limits).
export * from '@prisma/client';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
