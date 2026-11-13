import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/app/lib/auth';
import { RegisterForm } from '../AuthForms';

export const metadata = { title: 'Sign up' };

export default async function RegisterPage() {
    if (await getCurrentUser()) redirect('/dashboard');

    return (
        <div className="w-full max-w-md">
            <h1 className="text-center text-2xl font-semibold">Create an account</h1>
            <p className="mt-1.5 text-center text-sm text-slate-400">Then add your first company and start issuing invoices.</p>
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
                <RegisterForm />
            </div>
        </div>
    );
}
