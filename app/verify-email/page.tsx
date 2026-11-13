import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { confirmEmail } from '@/app/(auth)/actions';
import { getCurrentUser } from '@/app/lib/auth';
import { APP_NAME } from '@/app/lib/app';

export const metadata = { title: 'Email confirmation', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const token = (Array.isArray(params.token) ? params.token[0] : params.token) ?? '';
    const ok = await confirmEmail(token);
    const user = await getCurrentUser();

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
            <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-7 text-center shadow-2xl">
                {ok ? (
                    <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
                ) : (
                    <XCircle className="mx-auto h-10 w-10 text-rose-400" />
                )}
                <h1 className="mt-4 text-xl font-semibold">{ok ? 'Email confirmed' : 'The link is not valid'}</h1>
                <p className="mt-2 text-sm text-slate-400">
                    {ok
                        ? `Thank you! Your ${APP_NAME} account is ready.`
                        : 'The link has already been used or has expired. You can request a new one from the app.'}
                </p>
                <Link
                    href={user ? '/dashboard' : '/login'}
                    className="mt-6 inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                    {user ? 'Go to the app' : 'Sign in'}
                </Link>
            </div>
        </main>
    );
}
