'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, X, XCircle } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
    id: number;
    kind: ToastKind;
    title: string;
    message?: string;
}

export interface ToastOptions {
    kind?: ToastKind;
    title: string;
    message?: string;
    /** Milliseconds until auto-hide (default 4000; 0 = stays visible). */
    duration?: number;
}

interface ToastApi {
    toast: (options: ToastOptions) => void;
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    warning: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLES: Record<ToastKind, { box: string; icon: string }> = {
    success: { box: 'border-emerald-500/30 bg-emerald-500/10', icon: 'text-emerald-400' },
    error: { box: 'border-rose-500/30 bg-rose-500/10', icon: 'text-rose-400' },
    warning: { box: 'border-amber-500/30 bg-amber-500/10', icon: 'text-amber-400' },
    info: { box: 'border-sky-500/30 bg-sky-500/10', icon: 'text-sky-400' },
};

function ToastIcon({ kind }: { kind: ToastKind }) {
    const cls = `mt-0.5 h-5 w-5 shrink-0 ${KIND_STYLES[kind].icon}`;
    if (kind === 'success') return <CheckCircle2 className={cls} />;
    if (kind === 'error') return <XCircle className={cls} />;
    if (kind === 'warning') return <AlertTriangle className={cls} />;
    return <Clock className={cls} />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(1);
    const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

    const dismiss = useCallback((id: number) => {
        const timer = timers.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timers.current.delete(id);
        }
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const toast = useCallback(
        ({ kind = 'info', title, message, duration = 4000 }: ToastOptions) => {
            const id = nextId.current++;
            setToasts((prev) => [...prev.slice(-4), { id, kind, title, message }]);
            if (duration > 0) {
                timers.current.set(
                    id,
                    setTimeout(() => dismiss(id), duration),
                );
            }
        },
        [dismiss],
    );

    useEffect(() => {
        const activeTimers = timers.current;
        return () => {
            activeTimers.forEach((timer) => clearTimeout(timer));
            activeTimers.clear();
        };
    }, []);

    const api = useMemo<ToastApi>(
        () => ({
            toast,
            success: (title, message) => toast({ kind: 'success', title, message }),
            error: (title, message) => toast({ kind: 'error', title, message, duration: 6000 }),
            warning: (title, message) => toast({ kind: 'warning', title, message, duration: 5000 }),
            info: (title, message) => toast({ kind: 'info', title, message }),
        }),
        [toast],
    );

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div
                aria-live="polite"
                className="no-print pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
            >
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        role="status"
                        className={`pointer-events-auto flex animate-toast-in items-start gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur ${KIND_STYLES[t.kind].box}`}
                    >
                        <ToastIcon kind={t.kind} />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-100">{t.title}</p>
                            {t.message ? <p className="mt-0.5 text-sm text-slate-300">{t.message}</p> : null}
                        </div>
                        <button
                            type="button"
                            onClick={() => dismiss(t.id)}
                            aria-label="Dismiss notification"
                            className="rounded p-1 text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastApi {
    const ctx = useContext(ToastContext);
    if (!ctx) {
        throw new Error('useToast must be used inside <ToastProvider>.');
    }
    return ctx;
}
