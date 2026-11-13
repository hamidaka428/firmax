'use client';

import { useActionState } from 'react';
import { btnSecondary, inputCls } from '@/app/components/ui/styles';
import { assignOwner } from '../../../actions';
import type { AssignOwnerState } from '../../../actions';

export default function AssignOwnerForm({ companyId }: { companyId: number }) {
    const [state, action, pending] = useActionState(assignOwner.bind(null, companyId), { error: null } as AssignOwnerState);
    return (
        <form action={action} className="space-y-2">
            <div className="flex gap-2">
                <input name="email" type="email" required placeholder="user email" aria-label="New owner email" className={inputCls} />
                <button type="submit" disabled={pending} className={`${btnSecondary} shrink-0`}>
                    {pending ? '…' : 'Transfer'}
                </button>
            </div>
            {state.error ? <p className="text-xs text-rose-300">{state.error}</p> : null}
            {state.ok ? <p className="text-xs text-emerald-300">Company transferred.</p> : null}
        </form>
    );
}
