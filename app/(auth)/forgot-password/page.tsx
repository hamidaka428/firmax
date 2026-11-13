import { ForgotPasswordForm } from '../AuthForms';

export const metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
    return (
        <div className="w-full max-w-sm">
            <h1 className="text-center text-2xl font-semibold">Forgot password</h1>
            <p className="mt-1.5 text-center text-sm text-slate-400">We&apos;ll send you a link to choose a new password.</p>
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
                <ForgotPasswordForm />
            </div>
        </div>
    );
}
