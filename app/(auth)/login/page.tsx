import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/app/lib/auth';
import { LoginForm } from '../AuthForms';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
    const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';
    if (await getCurrentUser()) redirect(next);

    return (
        <div className="w-full max-w-sm">
            <h1 className="text-center text-2xl font-semibold">Sign in to your account</h1>
            <p className="mt-1.5 text-center text-sm text-slate-400">Invoices, contracts and inventory — in one place.</p>
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
                <LoginForm next={next} />
            </div>
        </div>
    );
}
