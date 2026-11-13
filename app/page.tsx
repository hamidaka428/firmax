import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import type { ComponentType } from 'react';
import { ArrowRight, Clock, FileText, Printer, Receipt, Upload, Users } from 'lucide-react';
import { getCurrentUser } from '@/app/lib/auth';
import { APP_NAME, REPO_URL } from '@/app/lib/app';

export const dynamic = 'force-dynamic';

const FEATURES: { icon: ComponentType<{ className?: string }>; title: string; text: string }[] = [
    { icon: Receipt, title: 'Invoices, credit notes & proformas', text: 'Sequential numbering with multiple series, any VAT rate with exemption notes, amount in words and multi-currency.' },
    { icon: FileText, title: 'Contracts from templates', text: 'Templates filled in with client details, dates and line items. Turn a contract into an invoice in one click.' },
    { icon: Clock, title: 'Recurring billing', text: 'Monthly, quarterly or yearly invoices generated from contracts and emailed to clients automatically.' },
    { icon: Users, title: 'Clients & inventory', text: 'VAT ID and IBAN validation, full client history, stock levels with low-stock alerts and automatic deduction.' },
    { icon: Printer, title: 'Email, links & PDF', text: 'Clean A4 documents with your logo. Send by email with a secure online link and see when the client opens it.' },
    { icon: Upload, title: 'Accountant export', text: 'A CSV of all invoices for the month that opens straight in Excel or Google Sheets.' },
];

const SETUP_STEPS: { title: string; code: string }[] = [
    { title: 'Get the code and start PostgreSQL', code: `git clone ${REPO_URL}.git\ncd firmax\ndocker compose up -d` },
    { title: 'Install and configure', code: 'npm install\ncp .env.example .env.local' },
    {
        title: 'Create the database schema',
        code: 'docker cp schema.sql erp_postgres:/tmp/schema.sql\ndocker exec erp_postgres psql -U erp_admin -d erp_database -v ON_ERROR_STOP=1 -f /tmp/schema.sql',
    },
    { title: 'Run it', code: 'npm run build\nnpm start' },
];

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const deleted = params.deleted === '1';
    let loggedIn = false;
    try {
        loggedIn = Boolean(await getCurrentUser());
    } catch (error) {
        unstable_rethrow(error);
        loggedIn = false; // without a database we still show the landing page
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
                <Link href="/" className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">{APP_NAME.charAt(0)}</span>
                    <span className="font-semibold">{APP_NAME}</span>
                </Link>
                <nav className="flex items-center gap-2">
                    <a href="#self-host" className="hidden rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-100 sm:inline">
                        Self-host
                    </a>
                    {loggedIn ? (
                        <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                            Go to the app
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                    ) : (
                        <>
                            <Link href="/login" className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:text-white">
                                Sign in
                            </Link>
                            <Link href="/register" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                                Sign up
                            </Link>
                        </>
                    )}
                </nav>
            </header>

            {deleted ? (
                <div className="mx-auto max-w-6xl px-4 sm:px-6">
                    <p className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-300">
                        Your account and all data have been deleted. Thank you for using {APP_NAME}.
                    </p>
                </div>
            ) : null}

            <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 text-center sm:px-6 sm:pt-20">
                <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                    Invoices, contracts and inventory — in one simple web app
                </h1>
                <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-400">
                    Issue invoices and credit notes, create contracts from templates, automate recurring billing and track your stock. Free and open source — run it on your own server.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                    <Link href={loggedIn ? '/dashboard' : '/register'} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-500">
                        {loggedIn ? 'Go to the app' : 'Get started'}
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                    <a href="#self-host" className="rounded-lg border border-slate-700 px-6 py-3 font-medium text-slate-200 hover:bg-slate-900">
                        Run it yourself
                    </a>
                </div>
                <p className="mt-3 text-xs text-slate-500">Open source under the MIT License.</p>
            </section>

            <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {FEATURES.map((f) => (
                        <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                            <f.icon className="h-5 w-5 text-indigo-400" />
                            <h3 className="mt-3 font-semibold">{f.title}</h3>
                            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{f.text}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section id="self-host" className="scroll-mt-10 border-t border-slate-800 bg-slate-900/30">
                <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
                    <h2 className="text-center text-3xl font-semibold">Run it on your own server</h2>
                    <p className="mt-3 text-center text-slate-400">
                        {APP_NAME} is free and open source. Your data stays in your own PostgreSQL database — no subscription, no limits.
                    </p>
                    <ol className="mt-10 space-y-4">
                        {SETUP_STEPS.map((step, i) => (
                            <li key={step.title} className="flex gap-4">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 font-mono text-sm font-semibold text-indigo-300">
                                    {i + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium text-slate-100">{step.title}</p>
                                    <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-slate-300">
                                        {step.code}
                                    </pre>
                                </div>
                            </li>
                        ))}
                    </ol>
                    <div className="mt-10 text-center">
                        <a
                            href={REPO_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-500"
                        >
                            View the source code
                            <ArrowRight className="h-4 w-4" />
                        </a>
                    </div>
                </div>
            </section>

            <footer className="border-t border-slate-800">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-slate-500 sm:px-6">
                    <span>© {new Date().getFullYear()} {APP_NAME}</span>
                    <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-slate-300">
                        Open source · MIT License
                    </a>
                </div>
            </footer>
        </div>
    );
}
