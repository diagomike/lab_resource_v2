import "server-only";
import type { MarkNotificationsReadInput, NotificationDto, NotificationsDto } from "@/lib/shared";
import { prisma } from "../prisma";

/** The newest notices for one person, and how many are unread. */
export async function listNotifications(userId: string, limit = 20): Promise<NotificationsDto> {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      include: { actor: { select: { name: true } } },
    }),
    unreadCount(userId),
  ]);
  return { items: rows.map(toNotificationDto), unread };
}

export function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, input: MarkNotificationsReadInput): Promise<number> {
  const where = input.all ? { userId, readAt: null } : { userId, readAt: null, id: { in: input.ids ?? [] } };
  return (await prisma.notification.updateMany({ where, data: { readAt: new Date() } })).count;
}

/** Notices older than 90 days go — the cron sweep. */
export async function sweepOldNotifications(): Promise<number> {
  return (await prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 24 * 3600 * 1000) } } })).count;
}

export function toNotificationDto(row: { id: string; title: string; body: string; path: string; readAt: Date | null; createdAt: Date; actor: { name: string } | null }): NotificationDto {
  return { id: row.id, title: row.title, body: row.body, path: row.path, actorName: row.actor?.name ?? null, read: row.readAt !== null, createdAt: row.createdAt.toISOString() };
}
