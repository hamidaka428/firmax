'use server';

import { SQL_TZ } from '@/app/lib/format';
import { revalidatePath } from 'next/cache';
import { query } from '@/app/lib/db';
import { requireUser } from '@/app/lib/auth';
import { getActiveCompanyId } from '@/app/lib/tenant';
import { contractShareUrl, ensureContractToken, parseRecipients, sendContractMail } from '@/app/lib/share';
import { lockedMinutes, registerFailure } from '@/app/lib/rate-limit';
import type { ActionResult } from '@/app/lib/types';

export async function getContractLink(contractId: number): Promise<ActionResult<{ url: string; token: string }>> {
    try {
        const companyId = await getActiveCompanyId();
        const body = await query<{ has: boolean }>(`SELECT body <> '' AS has FROM contracts WHERE id = $1 AND company_id = $2`, [contractId, companyId]);
        if (!body.rows[0]) return { ok: false, error: 'Contract not found.' };
        if (!body.rows[0].has) return { ok: false, error: 'The contract has no text — choose a template when editing so it can be shared.' };
        const token = await ensureContractToken(contractId, companyId);
        if (!token) return { ok: false, error: 'Contract not found.' };
        revalidatePath('/dashboard/contracts');
        return { ok: true, data: { url: contractShareUrl(token), token } };
    } catch (error) {
        console.error('getContractLink', error);
        return { ok: false, error: 'Failed to create the link.' };
    }
}

export async function revokeContractLink(contractId: number): Promise<ActionResult> {
    try {
        const companyId = await getActiveCompanyId();
        await query(`UPDATE contracts SET share_token = NULL, viewed_at = NULL WHERE id = $1 AND company_id = $2`, [contractId, companyId]);
        revalidatePath('/dashboard/contracts');
        return { ok: true, data: undefined };
    } catch (error) {
        console.error('revokeContractLink', error);
        return { ok: false, error: 'Failed to disable the link.' };
    }
}

export async function sendContractEmail(
    contractId: number,
    raw: { to: string; message: string; copyToMe: boolean },
): Promise<ActionResult<{ sent_at: string; sent_to: string; share_token: string }>> {
    const user = await requireUser();
    const to = parseRecipients(String(raw?.to ?? ''));
    if (!to) return { ok: false, error: 'Enter a valid email address (up to 5, separated by commas).' };
    const key = `send-invoice:${user.id}`; // shared limit with invoices
    if (lockedMinutes(key, 60) > 0) return { ok: false, error: 'You have sent too many emails. Please try again shortly.' };
    try {
        const companyId = await getActiveCompanyId();
        const r = await query<{ contract_number: string; title: string; company_name: string; company_email: string; has_body: boolean }>(
            `SELECT COALESCE(c.contract_number, '') AS contract_number, c.title, co.name AS company_name, co.email AS company_email,
                    c.body <> '' AS has_body
               FROM contracts c JOIN companies co ON co.id = c.company_id
              WHERE c.id = $1 AND c.company_id = $2`,
            [contractId, companyId],
        );
        const info = r.rows[0];
        if (!info) return { ok: false, error: 'Contract not found.' };
        if (!info.has_body) return { ok: false, error: 'The contract has no text — choose a template when editing so it can be sent.' };
        const token = await ensureContractToken(contractId, companyId);
        if (!token) return { ok: false, error: 'Contract not found.' };
        for (let i = 0; i < to.length; i++) registerFailure(key, 60);
        const sent = await sendContractMail(info, token, to, String(raw?.message ?? '').slice(0, 3000), raw?.copyToMe ? user.email : undefined);
        if (!sent.ok) return sent;
        const upd = await query<{ sent_at: string; sent_to: string }>(
            `UPDATE contracts SET sent_at = now(), sent_to = $3 WHERE id = $1 AND company_id = $2
             RETURNING to_char(sent_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD HH24:MI') AS sent_at, sent_to`,
            [contractId, companyId, to.join(', ').slice(0, 255)],
        );
        revalidatePath('/dashboard/contracts');
        return { ok: true, data: { ...upd.rows[0], share_token: token } };
    } catch (error) {
        console.error('sendContractEmail', error);
        return { ok: false, error: 'Sending failed.' };
    }
}
