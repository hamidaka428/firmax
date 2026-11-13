import { redirect } from 'next/navigation';
import { Settings } from 'lucide-react';
import { adminConfigured, isAdmin } from '@/app/lib/admin-auth';
import LoginForm from './LoginForm';

export const metadata = { title: 'Admin sign-in', robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
    if (await isAdmin()) redirect('/admin');

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
            <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl">
                <div className="mb-6 flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
                        <Settings className="h-5 w-5 text-white" />
                    </span>
                    <div>
                        <h1 className="text-lg font-semibold">Admin panel</h1>
                        <p className="text-xs text-slate-400">For the platform owner only</p>
                    </div>
                </div>
                <LoginForm configured={adminConfigured()} />
            </div>
        </main>
    );
}
