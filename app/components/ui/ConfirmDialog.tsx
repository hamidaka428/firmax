'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { Modal } from './Modal';
import { btnDanger, btnPrimary, btnSecondary } from './styles';

export type ConfirmTone = 'danger' | 'primary';

// ---------------------------------------------------------------------------
// 1) Controlled component
// ---------------------------------------------------------------------------
export interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: ConfirmTone;
    /** Shows a loading state and blocks closing while waiting for a Server Action. */
    loading?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
}

export function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'danger',
    loading = false,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const danger = tone === 'danger';

    return (
        <Modal
            open={open}
            onClose={onCancel}
            title={title}
            size="sm"
            busy={loading}
            footer={
                <>
                    <button type="button" className={btnSecondary} onClick={onCancel} disabled={loading}>
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className={danger ? btnDanger : btnPrimary}
                        onClick={() => void onConfirm()}
                        disabled={loading}
                    >
                        {loading ? 'Please wait…' : confirmLabel}
                    </button>
                </>
            }
        >
            <div className="flex items-start gap-4">
                <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                        danger ? 'bg-rose-500/10 text-rose-400' : 'bg-indigo-500/10 text-indigo-400'
                    }`}
                >
                    {danger ? <AlertTriangle className="h-5 w-5" /> : <Check className="h-5 w-5" />}
                </div>
                <div className="pt-1 text-sm leading-relaxed text-slate-300">{message}</div>
            </div>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// 2) Convenience hook: const confirm = useConfirm(); if (await confirm({...})) { ... }
// ---------------------------------------------------------------------------
export interface ConfirmOptions {
    title: string;
    message?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: ConfirmTone;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [pending, setPending] = useState<PendingConfirm | null>(null);

    const confirm = useCallback<ConfirmFn>((options) => {
        return new Promise<boolean>((resolve) => {
            setPending((previous) => {
                previous?.resolve(false); // if a dialog is already open — cancel it
                return { options, resolve };
            });
        });
    }, []);

    const settle = useCallback(
        (value: boolean) => {
            pending?.resolve(value);
            setPending(null);
        },
        [pending],
    );

    const contextValue = useMemo(() => confirm, [confirm]);

    return (
        <ConfirmContext.Provider value={contextValue}>
            {children}
            <ConfirmDialog
                open={pending !== null}
                title={pending?.options.title ?? ''}
                message={pending?.options.message}
                confirmLabel={pending?.options.confirmLabel}
                cancelLabel={pending?.options.cancelLabel}
                tone={pending?.options.tone ?? 'danger'}
                onConfirm={() => settle(true)}
                onCancel={() => settle(false)}
            />
        </ConfirmContext.Provider>
    );
}

export function useConfirm(): ConfirmFn {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error('useConfirm must be used inside <ConfirmProvider>.');
    }
    return ctx;
}
