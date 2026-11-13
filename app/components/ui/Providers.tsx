'use client';

import type { ReactNode } from 'react';
import { ToastProvider } from './ToastProvider';
import { ConfirmProvider } from './ConfirmDialog';

/** Wraps the app with the Toast and Confirm contexts (used in app/layout.tsx). */
export default function Providers({ children }: { children: ReactNode }) {
    return (
        <ToastProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
    );
}
