// Daily generation of recurring invoices for all companies.
// Called by a scheduler (server cron, Coolify/Railway scheduled job, cron-job.org) once a day, e.g. at 06:00:
//   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://firmax.bg/api/cron/recurring
// Without CRON_SECRET the route is disabled. Invoices are also generated when the dashboard opens, so cron is a safety net.

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runRecurringBilling } from '@/app/lib/recurring';

export const dynamic = 'force-dynamic';

function authorized(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 16 || !header) return false;
    const a = Buffer.from(header);
    const b = Buffer.from(`Bearer ${secret}`);
    return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
    if (!authorized(request.headers.get('authorization'))) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const generated = await runRecurringBilling();
    return NextResponse.json({ ok: true, generated: generated.length, invoices: generated });
}

export const GET = handle;
export const POST = handle;
