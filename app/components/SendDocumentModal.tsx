'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, Check, Eye, X } from 'lucide-react';
import { Modal } from '@/app/components/ui/Modal';
import { useToast } from '@/app/components/ui/ToastProvider';
import { btnPrimary, btnSecondary, inputCls, labelCls } from '@/app/components/ui/styles';
import { formatDate } from '@/app/lib/format';
import type { ActionResult } from '@/app/lib/types';

export interface ShareState {
    share_token: string | null;
    sent_at: string | null;
    sent_to: string;
    viewed_at: string | null;
}

export interface SendDocumentActions {
    send: (input: { to: string; message: string; copyToMe: boolean }) => Promise<ActionResult<{ sent_at: string; sent_to: string; share_token: string }>>;
    link: () => Promise<ActionResult<{ url: string; token: string }>>;
    revoke: () => Promise<ActionResult>;
}

function formatStamp(stamp: string): string {
    const [d, t] = stamp.split(' ');
    return `${formatDate(d)} ${t ?? ''}`.trim();
}

/** Sends a document (invoice or contract) by email + online link. */
export default function SendDocumentModal({
    title,
    description,
    state,
    clientEmail,
    defaultMessage,
    sentToast,
    origin,
    pathPrefix,
    actions,
    onClose,
    onChanged,
}: {
    title: string;
    description: string;
    state: ShareState;
    clientEmail: string;
    defaultMessage: string;
    /** Toast text after sending, e.g. "Invoice no. 1 sent" */
    sentToast: string;
    /** The site address (for displaying the link) */
    origin: string;
    /** '/i/' for invoices, '/c/' for contracts */
    pathPrefix: string;
    actions: SendDocumentActions;
    onClose: () => void;
    onChanged: (patch: Partial<ShareState>) => void;
}) {
    const toast = useToast();
    const [to, setTo] = useState(state.sent_to || clientEmail);
    const [message, setMessage] = useState(defaultMessage);
    const [copyToMe, setCopyToMe] = useState(false);
    const [token, setToken] = useState(state.share_token);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const link = token ? `${origin}${pathPrefix}${token}` : null;

    async function handleSend(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await actions.send({ to, message, copyToMe });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        setToken(res.data.share_token);
        onChanged({ share_token: res.data.share_token, sent_at: res.data.sent_at, sent_to: res.data.sent_to });
        toast.success(sentToast, res.data.sent_to);
        onClose();
    }

    async function handleCopy() {
        setError(null);
        let url = link;
        if (!url) {
            setBusy(true);
            const res = await actions.link();
            setBusy(false);
            if (!res.ok) return setError(res.error);
            setToken(res.data.token);
            onChanged({ share_token: res.data.token });
            url = res.data.url;
        }
        try {
            await navigator.clipboard.writeText(url);
            toast.success('Link copied', 'Send it to the client by email or messenger.');
        } catch {
            toast.info('Copy the link manually', url);
        }
    }

    async function handleRevoke() {
        setBusy(true);
        const res = await actions.revoke();
        setBusy(false);
        if (!res.ok) return setError(res.error);
        setToken(null);
        onChanged({ share_token: null, viewed_at: null });
        toast.success('Link disabled', 'The old address no longer opens the document.');
    }

    return (
        <Modal
            open
            onClose={onClose}
            title={title}
            description={description}
            size="lg"
            busy={busy}
            footer={
                <>
                    <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" form="send-doc-form" className={btnPrimary} disabled={busy}>
                        {busy ? 'Sending…' : 'Send by email'}
                    </button>
                </>
            }
        >
            <form id="send-doc-form" onSubmit={handleSend} className="space-y-4">
                {error ? (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {error}
                    </div>
                ) : null}

                {state.sent_at || state.viewed_at ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
                        {state.sent_at ? (
                            <span className="inline-flex items-center gap-1">
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                                Sent on {formatStamp(state.sent_at)} to {state.sent_to}
                            </span>
                        ) : null}
                        {state.viewed_at ? (
                            <span className="inline-flex items-center gap-1">
                                <Eye className="h-3.5 w-3.5 text-indigo-300" />
                                Opened by the client on {formatStamp(state.viewed_at)}
                            </span>
                        ) : null}
                    </div>
                ) : null}

                <div>
                    <label htmlFor="send-to" className={labelCls}>To (email) *</label>
                    <input id="send-to" type="text" inputMode="email" className={inputCls} value={to} maxLength={600}
                        placeholder="klient@firma.bg, schetovodstvo@firma.bg" onChange={(e) => setTo(e.target.value)} />
                    {!clientEmail ? (
                        <p className="mt-1 text-xs text-slate-500">The client has no email saved — add it under Clients so it&apos;s filled in automatically.</p>
                    ) : null}
                </div>
                <div>
                    <label htmlFor="send-msg" className={labelCls}>Message</label>
                    <textarea id="send-msg" rows={6} className={inputCls} value={message} maxLength={3000} onChange={(e) => setMessage(e.target.value)} />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={copyToMe} onChange={(e) => setCopyToMe(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-indigo-500" />
                    Send me a copy
                </label>

                <div className="rounded-lg border border-slate-800 p-3">
                    <p className="text-sm font-medium text-slate-200">Online link</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                        Anyone with the link can view the document. You can disable it at any time.
                    </p>
                    {link ? <p className="mt-2 break-all rounded bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-300">{link}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} onClick={handleCopy} disabled={busy}>
                            Copy link
                        </button>
                        {link ? (
                            <>
                                <a href={link} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} px-3 py-1.5 text-xs`}>
                                    <Eye className="h-3.5 w-3.5" />
                                    Open
                                </a>
                                <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs text-rose-300`} onClick={handleRevoke} disabled={busy}>
                                    <X className="h-3.5 w-3.5" />
                                    Disable link
                                </button>
                            </>
                        ) : null}
                    </div>
                </div>
            </form>
        </Modal>
    );
}
