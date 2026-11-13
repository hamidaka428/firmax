// app/lib/tokens.ts
// One-time tokens for email links. Only the SHA-256 of the token is stored in the database.

import { createHash, randomBytes } from 'crypto';
import { query } from './db';

export type TokenKind = 'reset' | 'verify';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Creates a new token and invalidates the user's previous unused tokens of the same kind. */
export async function createToken(userId: number, kind: TokenKind, ttlMinutes: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await query(`UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL`, [userId, kind]);
    await query(
        `INSERT INTO user_tokens (user_id, kind, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
        [userId, kind, hash(token), ttlMinutes],
    );
    // clean up old rows
    await query(`DELETE FROM user_tokens WHERE user_id = $1 AND expires_at < now() - INTERVAL '7 days'`, [userId]);
    return token;
}

/** Checks the token without consuming it (used to show the new-password form). */
export async function peekToken(token: string, kind: TokenKind): Promise<{ userId: number; email: string } | null> {
    if (!token || token.length > 100) return null;
    const res = await query<{ user_id: number; email: string }>(
        `SELECT t.user_id, u.email FROM user_tokens t JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = $1 AND t.kind = $2 AND t.used_at IS NULL AND t.expires_at > now()`,
        [hash(token), kind],
    );
    return res.rows[0] ? { userId: res.rows[0].user_id, email: res.rows[0].email } : null;
}

/** Consumes the token atomically — two concurrent attempts cannot both use it. */
export async function consumeToken(token: string, kind: TokenKind): Promise<number | null> {
    if (!token || token.length > 100) return null;
    const res = await query<{ user_id: number }>(
        `UPDATE user_tokens SET used_at = now()
          WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [hash(token), kind],
    );
    return res.rows[0]?.user_id ?? null;
}
