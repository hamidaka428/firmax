import { requireUser } from '@/app/lib/auth';
import { cardCls } from '@/app/components/ui/styles';
import { formatDate } from '@/app/lib/format';
import { DeleteAccountForm, PasswordForm, ProfileForm } from './AccountForms';

export const metadata = { title: 'Account' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
    const user = await requireUser();

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-100">Account</h1>
                <p className="mt-1 text-sm text-slate-400">Your profile, password and account settings.</p>
            </div>

            <section className={`${cardCls} p-6`}>
                <h2 className="mb-4 text-lg font-semibold text-slate-100">Profile</h2>
                <ProfileForm name={user.name} email={user.email} />
                <p className="mt-3 text-xs text-slate-500">Member since {formatDate(user.created_at)}.</p>
            </section>

            <section className={`${cardCls} p-6`}>
                <h2 className="mb-4 text-lg font-semibold text-slate-100">Change password</h2>
                <PasswordForm />
            </section>

            <section className={`${cardCls} border-rose-500/20 p-6`}>
                <h2 className="text-lg font-semibold text-slate-100">Delete account</h2>
                <p className="mb-4 mt-1 text-sm text-slate-400">Right to erasure (Art. 17 GDPR).</p>
                <DeleteAccountForm />
            </section>
        </div>
    );
}
