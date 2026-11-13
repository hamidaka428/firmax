'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle } from 'lucide-react';
import { resendVerification } from '@/app/(auth)/actions';

export default function VerifyEmailBanner({ email }: { email: string }) {
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    return (
        <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 sm:px-8">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
                Please confirm your email <span className="font-medium">{email}</span> — we sent you a link.
            </span>
            {message ? (
                <span className="text-amber-100/80">{message}</span>
            ) : (
                <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                        startTransition(async () => {
                            const res = await resendVerification();
                            setMessage(res.message);
                        })
                    }
                    className="font-medium underline underline-offset-2 hover:text-amber-100 disabled:opacity-60"
                >
                    {pending ? 'Sending…' : 'Resend'}
                </button>
            )}
        </div>
    );
}
