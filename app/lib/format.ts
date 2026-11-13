// Pure helpers (no database/server access) — safe for both server and client components.

const TZ_RE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/;

/** Business time zone used for "today", due dates and timestamps (NEXT_PUBLIC_APP_TIMEZONE, default UTC). */
export const TIME_ZONE = TZ_RE.test(process.env.NEXT_PUBLIC_APP_TIMEZONE ?? '') ? process.env.NEXT_PUBLIC_APP_TIMEZONE! : 'UTC';

/** The time zone as an SQL literal, e.g. 'Europe/Berlin' (validated above, so safe to interpolate). */
export const SQL_TZ = `'${TIME_ZONE}'`;

/** "Today" in PostgreSQL in the business time zone (for comparisons with DATE columns). */
export const SQL_TODAY = `(now() AT TIME ZONE ${SQL_TZ})::date`;

/** Display locale for numbers, money and dates. */
export const LOCALE = 'en-GB';

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today's date as 'YYYY-MM-DD' in the business time zone. */
export function todayISO(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function toUtcMs(iso: string): number {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

/** Calendar days from fromISO to toISO (positive when toISO is later). */
export function daysBetween(fromISO: string, toISO: string): number {
    return Math.round((toUtcMs(toISO) - toUtcMs(fromISO)) / 86_400_000);
}

export function pluralDays(n: number): string {
    return Math.abs(n) === 1 ? '1 day' : `${Math.abs(n)} days`;
}

/** 'YYYY-MM-DD' -> '12 Nov 2026' */
export function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1]} ${y}`;
}

export function formatNumber(value: number, fractionDigits = 2): string {
    return new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(value);
}

export function formatMoney(amount: number, currency = 'EUR'): string {
    try {
        return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(amount);
    } catch {
        return `${formatNumber(amount, 2)} ${currency}`;
    }
}

/** Quantities: up to 3 decimals, no trailing zeros. */
export function formatQty(value: number): string {
    return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 }).format(value);
}

export function formatCompact(value: number): string {
    return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Accepts "12.5" and "12,5"; returns null for an invalid or negative number. */
export function parseDecimal(input: string): number | null {
    const cleaned = input.trim().replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Contract validity (derived from end_date and status)
// ---------------------------------------------------------------------------
export type ValidityKind = 'closed' | 'indefinite' | 'valid' | 'soon' | 'expired';

export interface Validity {
    kind: ValidityKind;
    /** Days until the end (negative = expired). null when completed / open-ended. */
    days: number | null;
    label: string;
}

export const EXPIRING_SOON_DAYS = 14;

export function contractValidity(endDate: string | null, status: string, today: string): Validity {
    if (status === 'completed') return { kind: 'closed', days: null, label: 'Completed' };
    if (!endDate) return { kind: 'indefinite', days: null, label: 'Open-ended' };

    const days = daysBetween(today, endDate);
    if (days < 0) return { kind: 'expired', days, label: `Expired ${pluralDays(days)} ago` };
    if (days === 0) return { kind: 'soon', days, label: 'Expires today' };
    if (days <= EXPIRING_SOON_DAYS) return { kind: 'soon', days, label: `Expires in ${pluralDays(days)}` };
    return { kind: 'valid', days, label: `Valid (${pluralDays(days)} left)` };
}
