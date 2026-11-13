'use server';

import { SQL_TZ } from '@/app/lib/format';
import { revalidatePath } from 'next/cache';
import { query } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getActiveCompanyId } from '@/app/lib/tenant';
import { ensureInvoiceToken, invoiceShareUrl, parseRecipients, sendInvoiceMail } from '@/app/lib/share';
import type { InvoiceMailInfo } from '@/app/lib/share';
import { lockedMinutes, registerFailure } from '@/app/lib/rate-limit';
import type { ActionResult } from '@/app/lib/types';

/** Creates (or returns) the document's online link. */
export async function getInvoiceLink(invoiceId: number): Promise<ActionResult<{ url: string; token: string }>> {
    try {
        const companyId = await getActiveCompanyId();
        const token = await ensureInvoiceToken(invoiceId, companyId);
        if (!token) return { ok: false, error: 'Document not found.' };
        revalidatePath('/dashboard/invoices');
        return { ok: true, data: { url: invoiceShareUrl(token), token } };
    } catch (error) {
        console.error('getInvoiceLink', error);
        return { ok: false, error: 'Failed to create the link.' };
    }
}

/** Disables the old link (e.g. sent to the wrong address by mistake). The next share creates a new one. */
export async function revokeInvoiceLink(invoiceId: number): Promise<ActionResult> {
    try {
        const companyId = await getActiveCompanyId();
        await query(`UPDATE invoices SET share_token = NULL, viewed_at = NULL WHERE id = $1 AND company_id = $2`, [invoiceId, companyId]);
        revalidatePath('/dashboard/invoices');
        return { ok: true, data: undefined };
    } catch (error) {
        console.error('revokeInvoiceLink', error);
        return { ok: false, error: 'Failed to disable the link.' };
    }
}

export async function sendInvoiceEmail(
    invoiceId: number,
    raw: { to: string; message: string; copyToMe: boolean },
): Promise<ActionResult<{ sent_at: string; sent_to: string; share_token: string }>> {
    const user = await requireUser();
    const to = parseRecipients(String(raw?.to ?? ''));
    if (!to) return { ok: false, error: 'Enter a valid email address (up to 5, separated by commas).' };
    const message = String(raw?.message ?? '').slice(0, 3000);

    // Abuse protection (bulk sending): up to 60 emails per hour per user
    const key = `send-invoice:${user.id}`;
    if (lockedMinutes(key, 60) > 0) return { ok: false, error: 'You have sent too many emails. Please try again shortly.' };

    try {
        const companyId = await getActiveCompanyId();
        const info = await query<InvoiceMailInfo & { status: string }>(
            `SELECT i.doc_type, i.invoice_number, i.issue_date, i.due_date, i.total_amount::float8 AS total_amount, i.status,
                    co.currency, co.name AS company_name, co.email AS company_email,
                    COALESCE(ba.iban, co.iban) AS iban, COALESCE(cl.name, '') AS client_name
               FROM invoices i
               JOIN companies co ON co.id = i.company_id
               LEFT JOIN bank_accounts ba ON ba.id = i.bank_account_id
               LEFT JOIN clients cl ON cl.id = i.client_id
              WHERE i.id = $1 AND i.company_id = $2`,
            [invoiceId, companyId],
        );
        const inv = info.rows[0];
        if (!inv) return { ok: false, error: 'Document not found.' };
        if (inv.status === 'cancelled') return { ok: false, error: 'A cancelled document cannot be sent.' };

        const token = await ensureInvoiceToken(invoiceId, companyId);
        if (!token) return { ok: false, error: 'Document not found.' };

        for (let i = 0; i < to.length; i++) registerFailure(key, 60);
        const sent = await sendInvoiceMail(inv, token, to, message, raw?.copyToMe ? user.email : undefined);
        if (!sent.ok) return sent;

        const upd = await query<{ sent_at: string; sent_to: string }>(
            `UPDATE invoices SET sent_at = now(), sent_to = $3 WHERE id = $1 AND company_id = $2
             RETURNING to_char(sent_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD HH24:MI') AS sent_at, sent_to`,
            [invoiceId, companyId, to.join(', ').slice(0, 255)],
        );
        revalidatePath('/dashboard/invoices');
        return { ok: true, data: { ...upd.rows[0], share_token: token } };
    } catch (error) {
        console.error('sendInvoiceEmail', error);
        return { ok: false, error: 'Sending failed.' };
    }
}
