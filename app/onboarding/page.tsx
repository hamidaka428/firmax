import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/app/lib/auth';
import { getActiveCompany } from '@/app/lib/tenant';
import { APP_NAME } from '@/app/lib/app';
import { logout } from '@/app/(auth)/actions';
import OnboardingForm from './OnboardingForm';

export const metadata = { title: 'Your first company' };

export default async function OnboardingPage() {
    const user = await requireUser();
    if (await getActiveCompany()) redirect('/dashboard');

    return (
        <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
            <div className="mx-auto max-w-2xl">
                <div className="mb-6 flex items-center justify-between gap-3">
                    <Link href="/" className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">{APP_NAME.charAt(0)}</span>
                        <span className="font-semibold">{APP_NAME}</span>
                    </Link>
                    <form action={logout}>
                        <button type="submit" className="text-sm text-slate-400 hover:text-slate-200">Sign out</button>
                    </form>
                </div>
                <h1 className="text-2xl font-semibold">Welcome{user.name ? `, ${user.name.split(' ')[0]}` : ''}!</h1>
                <p className="mt-1.5 text-sm text-slate-400">
                    One last step: enter the details of the company you will issue invoices and contracts from.
                </p>
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
                    <OnboardingForm />
                </div>
            </div>
        </div>
    );
}
