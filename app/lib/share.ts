// app/lib/share.ts
// Online links to documents and sending them by email.

import { randomBytes } from 'node:crypto';
import type { DbClient } from './db';
import { query } from './db';
import { appUrl } from './app';
import { emailConfigured, sendEmail } from './email';
import { APP_NAME } from './app';
import { DOC_TITLE } from './documents';
import { formatDate, formatMoney } from './format';
import type { DocType } from './types';

export function newShareToken(): string {
    return randomBytes(24).toString('base64url'); // 32 characters, ~192 bits
}

export function invoiceShareUrl(token: string): string {
    return `${appUrl()}/i/${token}`;
}

export function contractShareUrl(token: string): string {
    return `${appUrl()}/c/${token}`;
}

/** Returns the existing token or creates a new one (inside a transaction or standalone). */
export async function ensureInvoiceToken(invoiceId: number, companyId: number, client?: DbClient): Promise<string | null> {
    const sql = `UPDATE invoices SET share_token = COALESCE(share_token, $3)
                  WHERE id = $1 AND company_id = $2 RETURNING share_token`;
    const params = [invoiceId, companyId, newShareToken()];
    const res = client ? await client.query<{ share_token: string }>(sql, params) : await query<{ share_token: string }>(sql, params);
    return res.rows[0]?.share_token ?? null;
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** "a@b.com, c@d.com" → array; null if any address is invalid. */
export function parseRecipients(value: string, max = 5): string[] | null {
    const list = value
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    if (list.length === 0 || list.length > max) return null;
    return list.every((x) => EMAIL_RE.test(x) && x.length <= 254) ? list : null;
}

export interface InvoiceMailInfo {
    doc_type: DocType;
    invoice_number: string;
    issue_date: string;
    due_date: string | null;
    total_amount: number;
    currency: string;
    company_name: string;
    company_email: string;
    iban: string;
    client_name: string;
    status: string;
}

/** Email to the client with a link to the document. */
export async function sendInvoiceMail(
    info: InvoiceMailInfo,
    token: string,
    to: string[],
    message: string,
    cc?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!emailConfigured()) {
        return { ok: false, error: 'Email sending is not configured on the server (SMTP). Copy the link and send it yourself.' };
    }
    const title = DOC_TITLE[info.doc_type];
    const titleCased = title.charAt(0) + title.slice(1).toLowerCase();
    const paragraphs: string[] = [];
    if (message.trim()) paragraphs.push(...message.trim().split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ')));
    else paragraphs.push('Hello,', `Here is your ${titleCased.toLowerCase()} no. ${info.invoice_number} dated ${formatDate(info.issue_date)}.`);

    const facts = [`Amount: ${formatMoney(info.total_amount, info.currency)}`];
    if (info.due_date && info.doc_type !== 'credit_note' && info.status !== 'paid') facts.push(`Due date: ${formatDate(info.due_date)}`);
    if (info.iban && info.doc_type !== 'credit_note' && info.status !== 'paid') facts.push(`IBAN: ${info.iban.replace(/(.{4})/g, '$1 ').trim()}`);
    // Key facts go before the signature so they are visible straight away
    paragraphs.splice(Math.max(1, paragraphs.length - (message.trim() && paragraphs.length > 2 ? 1 : 0)), 0, facts.join(' · '));

    const sent = await sendEmail({
        to: to.join(', '),
        cc,
        subject: `${titleCased} no. ${info.invoice_number} from ${info.company_name}`,
        heading: info.company_name,
        fromName: `${info.company_name} via ${APP_NAME}`,
        replyTo: info.company_email || undefined,
        paragraphs,
        button: { label: 'Open document', url: invoiceShareUrl(token) },
        footnote: `You can print the document or save it as a PDF from the link.${info.company_email ? ' For questions, reply to this email.' : ''}`,
    });
    return sent ? { ok: true } : { ok: false, error: 'The email was not sent — check the address and the SMTP settings.' };
}

export async function ensureContractToken(contractId: number, companyId: number): Promise<string | null> {
    const res = await query<{ share_token: string }>(
        `UPDATE contracts SET share_token = COALESCE(share_token, $3)
          WHERE id = $1 AND company_id = $2 RETURNING share_token`,
        [contractId, companyId, newShareToken()],
    );
    return res.rows[0]?.share_token ?? null;
}

export async function sendContractMail(
    info: { contract_number: string; title: string; company_name: string; company_email: string },
    token: string,
    to: string[],
    message: string,
    cc?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!emailConfigured()) {
        return { ok: false, error: 'Email sending is not configured on the server (SMTP). Copy the link and send it yourself.' };
    }
    const paragraphs = message.trim()
        ? message.trim().split(/\n{2,}/).map((p) => p.replace(/\n/g, ' '))
        : ['Hello,', `Here is contract no. ${info.contract_number} — ${info.title}.`];
    const sent = await sendEmail({
        to: to.join(', '),
        cc,
        subject: `Contract no. ${info.contract_number} from ${info.company_name}`,
        heading: info.company_name,
        fromName: `${info.company_name} via ${APP_NAME}`,
        replyTo: info.company_email || undefined,
        paragraphs,
        button: { label: 'Open contract', url: contractShareUrl(token) },
        footnote: `You can print the contract or save it as a PDF from the link.${info.company_email ? ' For questions, reply to this email.' : ''}`,
    });
    return sent ? { ok: true } : { ok: false, error: 'The email was not sent — check the address and the SMTP settings.' };
}
