import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import type { NextRequest } from 'next/server';
import { query } from '@/app/lib/db';
import { getActiveCompany } from '@/app/lib/tenant';
import { mimeFromFileName, resolveStoredPath } from '@/app/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function encodeRfc5987(value: string): string {
    return encodeURIComponent(value).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * GET /api/files/contracts/<uuid>.pdf            -> shows the file (inline, for iframe/img)
 * GET /api/files/contracts/<uuid>.pdf?download=1 -> downloads the file with its original name
 *
 * The file is returned only if it belongs to a contract/invoice of the ACTIVE company.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ filepath: string[] }> }) {
    const { filepath } = await ctx.params;

    const company = await getActiveCompany();
    if (!company) {
        return new Response('No active company.', { status: 401 });
    }

    const relativePath = (filepath ?? []).join('/');
    const absolutePath = resolveStoredPath(relativePath);
    if (!absolutePath) {
        return new Response('Invalid path.', { status: 400 });
    }

    // Authorisation: the file must belong to the active company.
    const owner = await query<{ file_name: string | null }>(
        `SELECT file_name FROM contracts WHERE company_id = $1 AND file_path = $2
         UNION ALL
         SELECT file_name FROM invoices  WHERE company_id = $1 AND file_path = $2
         UNION ALL
         SELECT 'logo' FROM companies WHERE id = $1 AND logo_path = $2
         LIMIT 1`,
        [company.id, relativePath],
    );
    if (owner.rows.length === 0) {
        return new Response('File not found.', { status: 404 });
    }

    let size: number;
    try {
        const info = await stat(absolutePath);
        if (!info.isFile()) return new Response('File not found.', { status: 404 });
        size = info.size;
    } catch {
        return new Response('File not found on disk.', { status: 404 });
    }

    const contentType = mimeFromFileName(absolutePath) ?? 'application/octet-stream';
    const download = request.nextUrl.searchParams.get('download') === '1';
    const originalName = owner.rows[0].file_name || filepath[filepath.length - 1];
    const disposition = `${download ? 'attachment' : 'inline'}; filename="file"; filename*=UTF-8''${encodeRfc5987(originalName)}`;

    const stream = createReadStream(absolutePath);
    const body = Readable.toWeb(stream) as unknown as ReadableStream;

    return new Response(body, {
        status: 200,
        headers: {
            'Content-Type': contentType,
            'Content-Length': String(size),
            'Content-Disposition': disposition,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-cache',
        },
    });
}
