// The company logo for a public document link (no sign-in — access is via the token).
import { readFile } from 'fs/promises';
import { query } from '@/app/lib/db';
import { mimeFromFileName, resolveStoredPath } from '@/app/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
    const { token } = await ctx.params;
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new Response('Not found.', { status: 404 });
    const res = await query<{ logo_path: string | null }>(
        `SELECT co.logo_path FROM invoices i JOIN companies co ON co.id = i.company_id WHERE i.share_token = $1
         UNION ALL
         SELECT co.logo_path FROM contracts c JOIN companies co ON co.id = c.company_id WHERE c.share_token = $1
         LIMIT 1`,
        [token],
    );
    const rel = res.rows[0]?.logo_path;
    const abs = rel ? resolveStoredPath(rel) : null;
    if (!rel || !abs) return new Response('Not found.', { status: 404 });
    try {
        const body = await readFile(abs);
        return new Response(new Uint8Array(body), {
            headers: {
                'Content-Type': mimeFromFileName(abs) ?? 'application/octet-stream',
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'private, max-age=300',
            },
        });
    } catch {
        return new Response('Not found.', { status: 404 });
    }
}
