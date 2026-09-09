import { Prisma } from '@fixly/database';

/** P2002 is Prisma's unique-constraint violation code. */
export function isUniqueConstraintError(error: unknown, target?: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  if (!target) return true;
  const fields = error.meta?.target;
  if (Array.isArray(fields)) return fields.includes(target);
  return typeof fields === 'string' ? fields.includes(target) : false;
}

/** P2025 means an update/delete matched no rows. */
export function isRecordNotFoundError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}
