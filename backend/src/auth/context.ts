import type { JWTPayload } from 'jose';

export interface AuthContext {
  /** Raw bearer token as received from the client. */
  token: string;
  /** Subject identifier from Keycloak. */
  sub: string;
  /** Optional human readable name. */
  name?: string;
  /** Preferred username claim. */
  username?: string;
  /** Email address when provided. */
  email?: string;
  /** External account / tenant identifier. */
  accountId?: string;
  /** Roles resolved from the access token. */
  roles: string[];
  /** Token issue timestamp when available. */
  issuedAt?: Date;
  /** Token expiry timestamp when available. */
  expiresAt?: Date;
  /** Full decoded payload for downstream checks. */
  payload: JWTPayload;
}
