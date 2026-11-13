// app/lib/recurring-options.ts
// Recurring billing options — separate from recurring.ts so client components can import them.

export const BILLING_OPTIONS = [
    { months: 0, label: 'No recurring billing' },
    { months: 1, label: 'Every month' },
    { months: 3, label: 'Every 3 months' },
    { months: 6, label: 'Every 6 months' },
    { months: 12, label: 'Every year' },
] as const;

/** Short label for lists: "monthly", "quarterly"… */
export function billingShort(months: number): string {
    switch (months) {
        case 1: return 'monthly';
        case 3: return 'quarterly';
        case 6: return 'every 6 months';
        case 12: return 'yearly';
        default: return '';
    }
}
