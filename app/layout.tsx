import type { Metadata } from 'next';
import { APP_NAME, APP_TAGLINE } from '@/app/lib/app';
// Fonts are bundled with the project (no requests to Google — faster, works offline and better for GDPR)
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';
import Providers from './components/ui/Providers';

export const metadata: Metadata = {
    title: {
        default: `${APP_NAME} — ${APP_TAGLINE}`,
        template: `%s · ${APP_NAME}`,
    },
    description: `${APP_NAME}: cloud invoicing with credit notes and proformas, contracts from templates, recurring billing, inventory and clients.`,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
    return (
        <html lang="en" className="h-full antialiased">
            <body className="flex min-h-full flex-col bg-slate-950 text-slate-100">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
