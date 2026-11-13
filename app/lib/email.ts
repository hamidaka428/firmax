// app/lib/email.ts
// Sends email over SMTP (works with Brevo, Resend, Mailgun, Gmail/Workspace, SendGrid, etc.).
// Without SMTP_HOST (local development) the email is NOT sent — it is printed to the server console.

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { APP_NAME } from './app';
import { appUrl } from './app';

let transport: Transporter | null = null;

export function emailConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST);
}

function getTransport(): Transporter {
    if (!transport) {
        const port = Number(process.env.SMTP_PORT || 587);
        transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
        });
    }
    return transport;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

interface Mail {
    to: string;
    subject: string;
    /** Plain-text paragraphs (no HTML) */
    paragraphs: string[];
    button?: { label: string; url: string };
    footnote?: string;
    /** Replies go to this address (e.g. the email of the company that sent the invoice) */
    replyTo?: string;
    /** Sender name instead of the platform name, e.g. "Northwind Supply Ltd via Firmax" */
    fromName?: string;
    /** Heading at the top of the email (defaults to the platform name) */
    heading?: string;
    cc?: string;
}

/** Simple template with inline styles that stays readable in dark mode (email clients don't support CSS files). */
function render(mail: Mail): { html: string; text: string } {
    const p = mail.paragraphs.map((t) => `<p style="margin:0 0 14px;line-height:1.6;color:#334155">${escapeHtml(t)}</p>`).join('');
    const btn = mail.button
        ? `<p style="margin:22px 0"><a href="${escapeHtml(mail.button.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${escapeHtml(mail.button.label)}</a></p>
           <p style="margin:0 0 14px;font-size:12px;color:#64748b;word-break:break-all">If the button doesn't work, copy this address: ${escapeHtml(mail.button.url)}</p>`
        : '';
    const foot = mail.footnote ? `<p style="margin:18px 0 0;font-size:12px;color:#64748b">${escapeHtml(mail.footnote)}</p>` : '';
    const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td>
<p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#0f172a">${escapeHtml(mail.heading ?? APP_NAME)}</p>
${p}${btn}${foot}
</td></tr></table>
<p style="margin:14px 0 0;font-size:11px;color:#94a3b8">${escapeHtml(APP_NAME)} · ${escapeHtml(appUrl())}</p>
</td></tr></table></body></html>`;
    const text = [...mail.paragraphs, mail.button ? `${mail.button.label}: ${mail.button.url}` : '', mail.footnote ?? '']
        .filter(Boolean)
        .join('\n\n');
    return { html, text };
}

/** Sender: the address always comes from MAIL_FROM (for SPF/DKIM); the display name can be the company's. */
function fromHeader(name?: string): string {
    const configured = process.env.MAIL_FROM || `${APP_NAME} <no-reply@${new URL(appUrl()).hostname}>`;
    if (!name) return configured;
    const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured.trim();
    const safe = name.replace(/["\\\r\n<>]/g, '').slice(0, 120);
    return `"${safe}" <${address}>`;
}

/** Sends an email. Errors are logged and never break the main action (returns false). */
export async function sendEmail(mail: Mail): Promise<boolean> {
    const { html, text } = render(mail);
    if (!emailConfigured()) {
        console.info(`\n[email — not sent, no SMTP configured] To: ${mail.to}\nSubject: ${mail.subject}\n${text}\n`);
        return false;
    }
    try {
        await getTransport().sendMail({
            from: fromHeader(mail.fromName),
            to: mail.to,
            cc: mail.cc || undefined,
            replyTo: mail.replyTo || undefined,
            subject: mail.subject,
            text,
            html,
        });
        return true;
    } catch (error) {
        console.error('[email] Failed to send to', mail.to, error);
        return false;
    }
}

export function resetPasswordEmail(to: string, name: string, url: string): Promise<boolean> {
    return sendEmail({
        to,
        subject: `Reset your password — ${APP_NAME}`,
        paragraphs: [
            `Hello${name ? ` ${name}` : ''},`,
            'We received a request to reset the password for your account. The link is valid for 1 hour and can be used only once.',
        ],
        button: { label: 'Set a new password', url },
        footnote: "If you didn't request a password reset, just ignore this email — your password stays the same.",
    });
}

export function verifyEmail(to: string, name: string, url: string): Promise<boolean> {
    return sendEmail({
        to,
        subject: `Confirm your email — ${APP_NAME}`,
        paragraphs: [
            `Hello${name ? ` ${name}` : ''},`,
            `Thanks for signing up for ${APP_NAME}. Please confirm your email address so we can send you important account notifications.`,
        ],
        button: { label: 'Confirm email', url },
        footnote: "The link is valid for 7 days. If you didn't create an account, ignore this email.",
    });
}

export function passwordChangedEmail(to: string, name: string): Promise<boolean> {
    return sendEmail({
        to,
        subject: `Your password was changed — ${APP_NAME}`,
        paragraphs: [
            `Hello${name ? ` ${name}` : ''},`,
            'The password for your account was just changed and you were signed out of all other devices.',
            "If this wasn't you, request a new password via \"Forgot password\" right away and contact us.",
        ],
        button: { label: 'Sign in', url: `${appUrl()}/login` },
    });
}
