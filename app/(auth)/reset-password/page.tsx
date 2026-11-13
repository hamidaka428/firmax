import Link from 'next/link';
import { peekToken } from '@/app/lib/tokens';
import { ResetPasswordForm } from '../AuthForms';

export const metadata = { title: 'New password', referrer: 'no-referrer' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const token = (Array.isArray(params.token) ? params.token[0] : params.token) ?? '';
    const valid = await peekToken(token, 'reset');

    return (
        <div className="w-full max-w-sm">
            <h1 className="text-center text-2xl font-semibold">New password</h1>
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
                {valid ? (
                    <>
                        <p className="mb-4 text-sm text-slate-400">
                            For account <span className="font-medium text-slate-200">{valid.email}</span>
                        </p>
                        <ResetPasswordForm token={token} />
                    </>
                ) : (
                    <div className="space-y-4 text-center">
                        <p className="text-sm text-slate-300">The link is invalid, already used or expired (it is valid for 1 hour).</p>
                        <Link href="/forgot-password" className="inline-flex text-sm font-medium text-indigo-300 hover:text-indigo-200">
                            Request a new link
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
