export const AuthEvents = {
  SESSION_REVOKED: 'auth.session_revoked',
} as const;

export interface SessionRevokedPayload {
  userId: string;
}
