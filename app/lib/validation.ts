// app/lib/validation.ts
// Country-agnostic validation and formatting helpers: company registration numbers, VAT IDs,
// IBAN / BIC, amount in words and common VAT exemption notes.

/* ----------------------------------------------------------------------------
 * Company registration number / tax ID
 * Formats differ by country, so we only check for a sensible length and character set.
 * ------------------------------------------------------------------------- */

export function normalizeRegNo(value: string): string {
    return value.trim().replace(/\s{2,}/g, ' ');
}

/** Validates a company registration number or tax ID. Empty is allowed. */
export function validateRegNo(value: string): string | null {
    if (!value) return null;
    if (value.length > 30) return 'Registration number is too long (max 30 characters).';
    return /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(value)
        ? null
        : 'Registration number may contain only letters, digits, spaces, dots, slashes and dashes.';
}

/* ----------------------------------------------------------------------------
 * VAT ID (EU format: 2-letter country prefix + 2–13 characters; other countries free-form)
 * ------------------------------------------------------------------------- */

export function normalizeVatNumber(value: string): string {
    return value.replace(/[\s.-]+/g, '').toUpperCase();
}

export function validateVatNumber(value: string): string | null {
    if (!value) return null;
    const v = normalizeVatNumber(value);
    if (v.length > 20) return 'VAT ID is too long.';
    return /^[A-Z]{2}[A-Z0-9+*]{2,13}$/.test(v) ? null : 'Invalid VAT ID — expected a country prefix and number, e.g. DE123456789.';
}

/* ----------------------------------------------------------------------------
 * IBAN (ISO 13616, mod 97)
 * ------------------------------------------------------------------------- */

export function normalizeIban(value: string): string {
    return value.replace(/\s+/g, '').toUpperCase();
}

export function validateIban(value: string): string | null {
    if (!value) return null;
    const v = normalizeIban(value);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return 'Invalid IBAN format.';
    const rearranged = v.slice(4) + v.slice(0, 4);
    let rem = 0;
    for (const ch of rearranged) {
        const n = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
        for (const c of n) rem = (rem * 10 + Number(c)) % 97;
    }
    return rem === 1 ? null : 'Invalid IBAN — the check digits do not match.';
}

export function formatIban(value: string): string {
    return normalizeIban(value).replace(/(.{4})/g, '$1 ').trim();
}

export function validateBic(value: string): string | null {
    if (!value) return null;
    return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value.toUpperCase())
        ? null
        : 'Invalid BIC/SWIFT code (8 or 11 characters, e.g. DEUTDEFF).';
}

/* ----------------------------------------------------------------------------
 * Amount in words (English)
 * ------------------------------------------------------------------------- */

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: [number, string][] = [[1_000_000_000, 'billion'], [1_000_000, 'million'], [1_000, 'thousand']];

function under1000(n: number): string {
    const parts: string[] = [];
    const h = Math.floor(n / 100);
    const r = n % 100;
    if (h) parts.push(`${ONES[h]} hundred`);
    if (r) {
        if (r < 20) parts.push(ONES[r]);
        else parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''));
    }
    return parts.join(' and ');
}

/** Whole number (0 … 999 999 999 999) in English words. */
export function integerToWords(value: number): string {
    let n = Math.floor(Math.abs(value));
    if (n === 0) return 'zero';
    if (n > 999_999_999_999) return String(n);
    const parts: string[] = [];
    for (const [size, name] of SCALES) {
        const k = Math.floor(n / size);
        n %= size;
        if (k) parts.push(`${under1000(k)} ${name}`);
    }
    if (n) parts.push(n < 100 && parts.length ? `and ${under1000(n)}` : under1000(n));
    return parts.join(' ');
}

const CURRENCY_WORDS: Record<string, [string, string, string, string]> = {
    // code: [major singular, major plural, minor singular, minor plural]
    EUR: ['euro', 'euros', 'cent', 'cents'],
    USD: ['US dollar', 'US dollars', 'cent', 'cents'],
    GBP: ['pound sterling', 'pounds sterling', 'penny', 'pence'],
    CHF: ['Swiss franc', 'Swiss francs', 'centime', 'centimes'],
    BGN: ['lev', 'leva', 'stotinka', 'stotinki'],
    RON: ['leu', 'lei', 'ban', 'bani'],
    PLN: ['zloty', 'zlotys', 'grosz', 'groszy'],
    CZK: ['koruna', 'korunas', 'haler', 'halers'],
    HUF: ['forint', 'forints', 'filler', 'fillers'],
    SEK: ['krona', 'kronor', 'öre', 'öre'],
    NOK: ['krone', 'kroner', 'øre', 'øre'],
    DKK: ['krone', 'kroner', 'øre', 'øre'],
    CAD: ['Canadian dollar', 'Canadian dollars', 'cent', 'cents'],
    AUD: ['Australian dollar', 'Australian dollars', 'cent', 'cents'],
};

/** Amount payable in words, e.g. "Three thousand nine hundred and fifty-two euros and 80 cents". */
export function amountInWords(amount: number, currency: string): string {
    const negative = amount < 0;
    const abs = Math.round(Math.abs(amount) * 100);
    const whole = Math.floor(abs / 100);
    const cents = abs % 100;
    const code = currency.toUpperCase();
    const w = CURRENCY_WORDS[code];

    let text = w
        ? `${integerToWords(whole)} ${whole === 1 ? w[0] : w[1]} and ${String(cents).padStart(2, '0')} ${cents === 1 ? w[2] : w[3]}`
        : `${integerToWords(whole)} ${code} and ${String(cents).padStart(2, '0')}/100`;
    if (negative) text = `minus ${text}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ----------------------------------------------------------------------------
 * VAT
 * ------------------------------------------------------------------------- */

/** Suggested VAT rates (percent). Any rate between 0 and 100 is accepted. */
export const VAT_RATE_SUGGESTIONS = [0, 5, 7, 9, 10, 13, 19, 20, 21, 23, 25] as const;

/** Common notes for invoices without VAT — many jurisdictions require the reason to be stated. */
export const VAT_EXEMPT_REASONS = [
    'Reverse charge — VAT to be accounted for by the recipient (Art. 196, Directive 2006/112/EC)',
    'Intra-Community supply of goods — exempt (Art. 138, Directive 2006/112/EC)',
    'Export outside the EU — exempt (Art. 146, Directive 2006/112/EC)',
    'Supplier is not registered for VAT',
    'Small business exemption — VAT not charged',
    'Exempt supply under local VAT law',
] as const;

/* ----------------------------------------------------------------------------
 * Currencies
 * ------------------------------------------------------------------------- */

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN'] as const;
