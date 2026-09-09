import { Prisma } from '@fixly/database';
import { redactMetadata } from './redact';

/**
 * Writes an audit entry on the caller's transaction so a privileged action and
 * its log entry either both land or neither does.
 *
 * Metadata is redacted on the way in: audit logs are readable by every admin,
 * so raw DTOs must never be persisted verbatim.
 */
export function writeAudit(
  transaction: Prisma.TransactionClient,
  entry: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
) {
  return transaction.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: redactMetadata(entry.metadata) as Prisma.InputJsonValue | undefined,
    },
  });
}
