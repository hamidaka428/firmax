'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { switchCompany } from '@/app/lib/tenant-actions';

/** "Switch to company" button for a document that belongs to another company. */
export default function SwitchToCompany({ companyId, companyName }: { companyId: number; companyName: string }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    return (
        <button
            type="button"
            disabled={pending}
            onClick={() =>
                startTransition(async () => {
                    const res = await switchCompany(companyId);
                    if (res.ok) router.refresh();
                })
            }
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
        >
            {pending ? 'Switching…' : `Switch to ${companyName}`}
            <ArrowRight className="h-4 w-4" />
        </button>
    );
}
