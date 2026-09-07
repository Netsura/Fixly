import { UserRole } from '@fixly/database';

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
};

export type AuthTokenPayload = {
  sub: string;
  role: UserRole;
  sessionId: string;
};
