'use client';

import { Printer } from 'lucide-react';

export default function PrintButton({ label = 'Print' }: { label?: string }) {
    return (
        <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
        >
            <Printer className="h-4 w-4" />
            {label}
        </button>
    );
}
