import type { ReactNode } from 'react';
import { redirect, unstable_rethrow } from 'next/navigation';
import UserMenu from '@/app/components/UserMenu';
import VerifyEmailBanner from '@/app/components/VerifyEmailBanner';
import { getCurrentUser } from '@/app/lib/auth';
import type { User } from '@/app/lib/auth';
import Sidebar from '@/app/components/Sidebar';
import CompanySwitcher from '@/app/components/CompanySwitcher';
import { getActiveCompany, listCompanies, logoUrl } from '@/app/lib/tenant';
import type { Company } from '@/app/lib/tenant';
import { formatDate, todayISO } from '@/app/lib/format';

function DbErrorScreen() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-slate-100">
            <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
                <h1 className="text-xl font-semibold">Cannot connect to the database</h1>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">
                    Check that PostgreSQL is running and that the PG* settings in .env.local are correct, then refresh the page.
                </p>
            </div>
        </div>
    );
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
    let user: User | null;
    let company: Company | null = null;
    let companies: Company[] = [];
    try {
        user = await getCurrentUser();
        if (user) [company, companies] = await Promise.all([getActiveCompany(), listCompanies()]);
    } catch (error) {
        unstable_rethrow(error); // Next.js internal signals (dynamic rendering, redirect) are not errors
        console.error('Failed to load the account:', error);
        return <DbErrorScreen />;
    }

    // redirect() is outside try/catch — it works by throwing a special error
    if (!user) redirect('/login');
    if (!company) redirect('/onboarding');

    return (
        <div className="flex min-h-screen bg-slate-950 text-slate-100 print:block print:min-h-0 print:bg-white print:text-black">
            <Sidebar />

            <div className="flex min-w-0 flex-1 flex-col print:block">
                <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/70 px-4 backdrop-blur sm:px-8">
                    <CompanySwitcher
                        companies={companies.map((c) => ({ id: c.id, name: c.name, reg_no: c.reg_no }))}
                        activeId={company.id}
                        activeLogoUrl={logoUrl(company.logo_path)}
                    />
                    <div className="flex shrink-0 items-center gap-3">
                        <span className="hidden text-xs text-slate-500 lg:inline">Today: {formatDate(todayISO())}</span>
                        <UserMenu name={user.name} email={user.email} />
                    </div>
                </header>

                {!user.email_verified ? <VerifyEmailBanner email={user.email} /> : null}
                <main className="flex-1 p-4 sm:p-8 print:p-0">{children}</main>
            </div>
        </div>
    );
}
