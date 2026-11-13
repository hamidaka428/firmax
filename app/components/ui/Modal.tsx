'use client';

import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared helper hooks
// ---------------------------------------------------------------------------
const noopSubscribe = () => () => {};

/** true only in the browser (SSR-safe, no setState in an effect). */
function useIsClient(): boolean {
    return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

let scrollLockCount = 0;

function useOverlayBehavior(
    open: boolean,
    onClose: () => void,
    closable: boolean,
    panelRef: React.RefObject<HTMLDivElement | null>,
) {
    const onCloseRef = useRef(onClose);
    const closableRef = useRef(closable);
    useEffect(() => {
        onCloseRef.current = onClose;
        closableRef.current = closable;
    });

    // Scroll lock + Escape + focus restore
    useEffect(() => {
        if (!open) return;

        const previouslyFocused = document.activeElement as HTMLElement | null;
        scrollLockCount += 1;
        document.body.style.overflow = 'hidden';

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && closableRef.current) {
                e.stopPropagation();
                onCloseRef.current();
            }
        };
        document.addEventListener('keydown', onKeyDown);

        const focusTimer = window.setTimeout(() => {
            const panel = panelRef.current;
            if (!panel || panel.contains(document.activeElement)) return;
            const firstField = panel.querySelector<HTMLElement>(
                'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
            );
            (firstField ?? panel).focus();
        }, 30);

        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('keydown', onKeyDown);
            scrollLockCount -= 1;
            if (scrollLockCount <= 0) {
                scrollLockCount = 0;
                document.body.style.overflow = '';
            }
            previouslyFocused?.focus?.();
        };
    }, [open, panelRef]);
}

interface OverlayBaseProps {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    /** While true, Esc / outside click / X don't close (e.g. while saving). */
    busy?: boolean;
    closeOnBackdrop?: boolean;
}

// ---------------------------------------------------------------------------
// Modal — centred dialog
// ---------------------------------------------------------------------------
const MODAL_WIDTH = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-6xl',
} as const;

export type ModalSize = keyof typeof MODAL_WIDTH;

export interface ModalProps extends OverlayBaseProps {
    size?: ModalSize;
}

export function Modal({
    open,
    onClose,
    title,
    description,
    children,
    footer,
    size = 'md',
    busy = false,
    closeOnBackdrop = true,
}: ModalProps) {
    const isClient = useIsClient();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    const closable = !busy;

    useOverlayBehavior(open, onClose, closable, panelRef);

    if (!isClient || !open) return null;

    return createPortal(
        <div
            className="no-print fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && closeOnBackdrop && closable) onClose();
            }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={`flex max-h-[90vh] w-full animate-pop-in flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl outline-none ${MODAL_WIDTH[size]}`}
            >
                <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-4">
                    <div className="min-w-0">
                        <h2 id={titleId} className="truncate text-lg font-semibold text-slate-100">
                            {title}
                        </h2>
                        {description ? <p className="mt-0.5 text-sm text-slate-400">{description}</p> : null}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={!closable}
                        aria-label="Close"
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

                {footer ? (
                    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 px-6 py-4">
                        {footer}
                    </div>
                ) : null}
            </div>
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------------
// Drawer — panel that slides in from the right
// ---------------------------------------------------------------------------
const DRAWER_WIDTH = {
    md: 'max-w-md',
    lg: 'max-w-xl',
    xl: 'max-w-3xl',
} as const;

export type DrawerWidth = keyof typeof DRAWER_WIDTH;

export interface DrawerProps extends OverlayBaseProps {
    width?: DrawerWidth;
}

export function Drawer({
    open,
    onClose,
    title,
    description,
    children,
    footer,
    width = 'lg',
    busy = false,
    closeOnBackdrop = true,
}: DrawerProps) {
    const isClient = useIsClient();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    const closable = !busy;

    useOverlayBehavior(open, onClose, closable, panelRef);

    if (!isClient || !open) return null;

    return createPortal(
        <div
            className="no-print fixed inset-0 z-50 animate-fade-in bg-slate-950/70 backdrop-blur-sm"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && closeOnBackdrop && closable) onClose();
            }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={`absolute inset-y-0 right-0 flex w-full animate-slide-in-right flex-col border-l border-slate-800 bg-slate-900 shadow-2xl outline-none ${DRAWER_WIDTH[width]}`}
            >
                <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-4">
                    <div className="min-w-0">
                        <h2 id={titleId} className="truncate text-lg font-semibold text-slate-100">
                            {title}
                        </h2>
                        {description ? <p className="mt-0.5 text-sm text-slate-400">{description}</p> : null}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={!closable}
                        aria-label="Close"
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

                {footer ? (
                    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 px-6 py-4">
                        {footer}
                    </div>
                ) : null}
            </div>
        </div>,
        document.body,
    );
}
