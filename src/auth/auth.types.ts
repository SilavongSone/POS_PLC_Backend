/** The signed-in user attached to each authenticated request. */
export type AuthUser = {
  id: string;
  username: string;
  fullName: string;
  groupId: string;
  groupName: string;
  permissions: string[];
};

/** Access-token claims. Permissions are not in the token: they are reloaded per request. */
export type AccessTokenPayload = { sub: string; typ: 'access' };

/** Short-lived token proving that `sub` (a manager) approved `perm` for user `req`. */
export type ApprovalTokenPayload = {
  sub: string;
  typ: 'approval';
  perm: string;
  req: string;
};

export type AuthTokens = {
  accessToken: string;
  /** Opaque; send it to /auth/refresh to rotate. */
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  user: AuthUser;
};
