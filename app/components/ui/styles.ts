// Shared Tailwind classes for a consistent look of buttons and inputs across all modules.

export const btnBase =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 disabled:opacity-50 disabled:cursor-not-allowed';

export const btnPrimary = `${btnBase} bg-indigo-600 text-white hover:bg-indigo-500`;
export const btnSecondary = `${btnBase} border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`;
export const btnGhost = `${btnBase} text-slate-300 hover:bg-slate-800`;
export const btnDanger = `${btnBase} bg-rose-600 text-white hover:bg-rose-500`;

export const inputCls =
    'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 ' +
    'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60';

export const labelCls = 'mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400';

export const cardCls = 'rounded-xl border border-slate-800 bg-slate-900';

export const badgeBase = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium';
export const badgeEmerald = `${badgeBase} border-emerald-500/20 bg-emerald-500/10 text-emerald-400`;
export const badgeAmber = `${badgeBase} border-amber-500/20 bg-amber-500/10 text-amber-400`;
export const badgeRose = `${badgeBase} border-rose-500/20 bg-rose-500/10 text-rose-400`;
export const badgeSlate = `${badgeBase} border-slate-600/40 bg-slate-700/30 text-slate-300`;
