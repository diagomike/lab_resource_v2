import "server-only";
import { PrismaClient } from "@prisma/client";

/**
 * The standard Next.js dev-hot-reload-safe singleton. `next dev`'s fast refresh
 * re-evaluates modules on every change; without caching the client on `globalThis`,
 * each reload would open a fresh pool of Postgres connections and never close the old
 * ones. Replaces PrismaService's DI/OnModuleInit pattern, which has no meaning outside
 * a DI container.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
