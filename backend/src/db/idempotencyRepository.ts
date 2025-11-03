import { getDb } from './index.js';

export type IdempotencyRecord = {
  key: string;
  accountId: string; // normalized ('' for none)
  scope: string;
  bodyHash: string;
  status: number;
  responseJson: string;
  createdAt: string;
  expiresAt: string | null;
};

export function findIdempotencyRecord(key: string, accountId: string, scope: string): IdempotencyRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT key as key, account_id as accountId, scope, body_hash as bodyHash, status, response_json as responseJson, created_at as createdAt, expires_at as expiresAt
       FROM idempotency_keys WHERE key=@key AND account_id=@accountId AND scope=@scope LIMIT 1`,
    )
    .get({ key, accountId, scope }) as any;
  return row ?? null;
}

export function saveIdempotencyRecord(params: {
  key: string;
  accountId: string;
  scope: string;
  bodyHash: string;
  status: number;
  responseJson: string;
  ttlSeconds?: number;
}): void {
  const db = getDb();
  const ttlSeconds = Number.isFinite(params.ttlSeconds) ? Number(params.ttlSeconds) : 900; // 15 min default
  db
    .prepare(
      `INSERT OR REPLACE INTO idempotency_keys (key, account_id, scope, body_hash, status, response_json, created_at, expires_at)
       VALUES (@key, @account_id, @scope, @body_hash, @status, @response_json, datetime('now'), datetime('now', @ttl))`,
    )
    .run({
      key: params.key,
      account_id: params.accountId,
      scope: params.scope,
      body_hash: params.bodyHash,
      status: params.status,
      response_json: params.responseJson,
      ttl: `+${ttlSeconds} seconds`,
    });
}

