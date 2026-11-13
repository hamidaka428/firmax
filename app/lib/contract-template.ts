// app/lib/contract-template.ts
// Contract templates: the list of fields, filling in the text and parsing it for printing.
// Plain TypeScript — used both in the browser (live preview) and on the server.

import { amountInWords, formatIban } from './validation';
import { formatDate, formatMoney, round } from './format';
import { CONTRACT_TYPE_LABEL } from './labels';
import type { ContractType } from './types';

/** Marker for the line-items table — replaced with the contract's actual lines when printing. */
export const ITEMS_TABLE_TOKEN = '{{items_table}}';

export interface TemplateField {
    key: string;
    label: string;
}

export interface TemplateFieldGroup {
    title: string;
    fields: TemplateField[];
}

/** Every field that can be inserted into a template. */
export const TEMPLATE_FIELD_GROUPS: TemplateFieldGroup[] = [
    {
        title: 'Contract',
        fields: [
            { key: 'contract.number', label: 'Number' },
            { key: 'contract.subject', label: 'Subject' },
            { key: 'contract.type', label: 'Type' },
            { key: 'contract.start', label: 'Start date' },
            { key: 'contract.end', label: 'End date' },
            { key: 'contract.term', label: 'Term (e.g. 12 months)' },
            { key: 'contract.amount', label: 'Amount excl. VAT' },
            { key: 'contract.amount_words', label: 'Amount excl. VAT in words' },
            { key: 'contract.vat', label: 'VAT' },
            { key: 'contract.amount_incl_vat', label: 'Amount incl. VAT' },
            { key: 'contract.amount_incl_vat_words', label: 'Amount incl. VAT in words' },
            { key: 'contract.notes', label: 'Notes' },
            { key: 'items_table', label: 'Line items table' },
            { key: 'today', label: "Today's date" },
        ],
    },
    {
        title: 'Our company',
        fields: [
            { key: 'company.role', label: 'Role (Seller / Lessor / Contractor)' },
            { key: 'company.name', label: 'Name' },
            { key: 'company.reg_no', label: 'Registration no.' },
            { key: 'company.vat_id', label: 'VAT ID' },
            { key: 'company.city', label: 'City' },
            { key: 'company.address', label: 'Address' },
            { key: 'company.country', label: 'Country' },
            { key: 'company.representative', label: 'Representative' },
            { key: 'company.phone', label: 'Phone' },
            { key: 'company.email', label: 'Email' },
            { key: 'company.bank', label: 'Bank' },
            { key: 'company.iban', label: 'IBAN' },
            { key: 'company.bic', label: 'BIC/SWIFT' },
        ],
    },
    {
        title: 'Client',
        fields: [
            { key: 'client.role', label: 'Role (Buyer / Lessee / Customer)' },
            { key: 'client.name', label: 'Name' },
            { key: 'client.reg_no', label: 'Registration no. / ID' },
            { key: 'client.vat_id', label: 'VAT ID' },
            { key: 'client.city', label: 'City' },
            { key: 'client.address', label: 'Address' },
            { key: 'client.country', label: 'Country' },
            { key: 'client.representative', label: 'Representative' },
            { key: 'client.phone', label: 'Phone' },
            { key: 'client.email', label: 'Email' },
        ],
    },
];

const KNOWN_KEYS = new Set(TEMPLATE_FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.key)));

/** The parties' roles by contract type: [our company, the client]. */
export const PARTY_ROLES: Record<ContractType, [string, string]> = {
    sale: ['SELLER', 'BUYER'],
    rental: ['LESSOR', 'LESSEE'],
    service: ['CONTRACTOR', 'CUSTOMER'],
};

export interface TemplateParty {
    name: string;
    reg_no: string;
    vat_number: string;
    city: string;
    address: string;
    country?: string;
    representative: string;
    phone: string;
    email: string;
}

export interface TemplateCompany extends TemplateParty {
    bank_name: string;
    iban: string;
    bic: string;
    currency: string;
}

export interface TemplateContext {
    company: TemplateCompany;
    client: TemplateParty | null;
    contract: {
        number: string;
        title: string;
        type: ContractType;
        start_date: string;
        end_date: string | null;
        total: number;
        notes: string;
        /** VAT rate for the "incl. VAT" fields (default 20%) */
        vat_rate?: number;
    };
    today: string;
}

const FIELD_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Length of a term as text: "12 months", "1 year", "45 days" or "open-ended". */
export function durationText(start: string, end: string | null): string {
    if (!end) return 'open-ended';
    const s = new Date(`${start}T00:00:00Z`);
    const e = new Date(`${end}T00:00:00Z`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return '';
    // The end date is inclusive: 1 Jan – 31 Dec = 12 months
    const next = new Date(e.getTime() + 86_400_000);
    let months = (next.getUTCFullYear() - s.getUTCFullYear()) * 12 + (next.getUTCMonth() - s.getUTCMonth());
    if (next.getUTCDate() !== s.getUTCDate()) months = -1;
    if (months > 0) {
        if (months % 12 === 0) {
            const y = months / 12;
            return y === 1 ? '1 (one) year' : `${y} years`;
        }
        return months === 1 ? '1 (one) month' : `${months} months`;
    }
    const days = Math.round((next.getTime() - s.getTime()) / 86_400_000);
    return days === 1 ? '1 day' : `${days} days`;
}

/** End date for a term of N months (inclusive): 2026-01-01 + 12 → 2026-12-31. */
export function endDateForMonths(start: string, months: number): string {
    const s = new Date(`${start}T00:00:00Z`);
    if (Number.isNaN(s.getTime())) return '';
    const target = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + months, s.getUTCDate()));
    // 31 Jan + 1 month → 3 Mar in JS; clamp to the last day of the month
    if (target.getUTCDate() !== s.getUTCDate()) target.setUTCDate(0);
    target.setUTCDate(target.getUTCDate() - 1);
    return target.toISOString().slice(0, 10);
}

/** Values of all fields for a given context. */
export function fieldValues(ctx: TemplateContext): Record<string, string> {
    const cur = ctx.company.currency;
    const total = round(ctx.contract.total, 2);
    const vatRate = ctx.contract.vat_rate ?? 20;
    const vat = round((total * vatRate) / 100, 2);
    const withVat = round(total + vat, 2);
    const [companyRole, clientRole] = PARTY_ROLES[ctx.contract.type];
    const c = ctx.client;
    const joinAddress = (city: string, address: string) => [city, address].filter(Boolean).join(', ');

    return {
        'contract.number': ctx.contract.number,
        'contract.subject': ctx.contract.title,
        'contract.type': CONTRACT_TYPE_LABEL[ctx.contract.type],
        'contract.start': formatDate(ctx.contract.start_date),
        'contract.end': ctx.contract.end_date ? formatDate(ctx.contract.end_date) : 'open-ended',
        'contract.term': durationText(ctx.contract.start_date, ctx.contract.end_date),
        'contract.amount': formatMoney(total, cur),
        'contract.amount_words': amountInWords(total, cur),
        'contract.vat': `${formatMoney(vat, cur)} (${vatRate}%)`,
        'contract.amount_incl_vat': formatMoney(withVat, cur),
        'contract.amount_incl_vat_words': amountInWords(withVat, cur),
        'contract.notes': ctx.contract.notes,
        today: formatDate(ctx.today),

        'company.role': companyRole,
        'company.name': ctx.company.name,
        'company.reg_no': ctx.company.reg_no,
        'company.vat_id': ctx.company.vat_number,
        'company.city': ctx.company.city,
        'company.address': joinAddress(ctx.company.city, ctx.company.address),
        'company.country': ctx.company.country ?? '',
        'company.representative': ctx.company.representative,
        'company.phone': ctx.company.phone,
        'company.email': ctx.company.email,
        'company.bank': ctx.company.bank_name,
        'company.iban': ctx.company.iban ? formatIban(ctx.company.iban) : '',
        'company.bic': ctx.company.bic,

        'client.role': clientRole,
        'client.name': c?.name ?? '',
        'client.reg_no': c?.reg_no ?? '',
        'client.vat_id': c?.vat_number ?? '',
        'client.city': c?.city ?? '',
        'client.address': c ? joinAddress(c.city, c.address) : '',
        'client.country': c?.country ?? '',
        'client.representative': c?.representative ?? '',
        'client.phone': c?.phone ?? '',
        'client.email': c?.email ?? '',
    };
}

/**
 * Fills in the template. Empty values become "………………" (space to fill in by hand),
 * and {{items_table}} stays as a marker — the table is drawn when printing.
 */
export function renderTemplate(body: string, ctx: TemplateContext): string {
    const values = fieldValues(ctx);
    return body.replace(FIELD_RE, (match, rawKey: string) => {
        const key = rawKey.trim();
        if (key === 'items_table') return ITEMS_TABLE_TOKEN;
        if (!(key in values)) return match; // unknown field — leave it visible
        return values[key] || '………………';
    });
}

/** Fields in the text that the app doesn't recognise (typo in the name). */
export function unknownFields(body: string): string[] {
    const out = new Set<string>();
    for (const m of body.matchAll(FIELD_RE)) {
        const key = m[1].trim();
        if (!KNOWN_KEYS.has(key)) out.add(key);
    }
    return Array.from(out);
}

/* ----------------------------------------------------------------------------
 * Parsing the text for display/printing
 *   # Title           → centred title
 *   ## Section        → bold sub-heading line
 *   **text**          → bold text within a line
 *   blank line        → new paragraph
 *   {{items_table}} on its own line → the line-items table
 * ------------------------------------------------------------------------- */

export type DocBlock =
    | { kind: 'title'; text: string }
    | { kind: 'heading'; text: string }
    | { kind: 'paragraph'; lines: string[] }
    | { kind: 'items' };

export function parseDocument(text: string): DocBlock[] {
    const blocks: DocBlock[] = [];
    let para: string[] = [];
    const flush = () => {
        if (para.length) blocks.push({ kind: 'paragraph', lines: para });
        para = [];
    };

    for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
        const line = rawLine.trimEnd();
        const trimmed = line.trim();
        if (!trimmed) {
            flush();
        } else if (trimmed === ITEMS_TABLE_TOKEN) {
            flush();
            blocks.push({ kind: 'items' });
        } else if (trimmed.startsWith('## ')) {
            flush();
            blocks.push({ kind: 'heading', text: trimmed.slice(3).trim() });
        } else if (trimmed.startsWith('# ')) {
            flush();
            blocks.push({ kind: 'title', text: trimmed.slice(2).trim() });
        } else {
            para.push(line);
        }
    }
    flush();
    return blocks;
}

/** Splits a line into bold / non-bold parts (**text**). */
export function splitBold(line: string): { text: string; bold: boolean }[] {
    const parts: { text: string; bold: boolean }[] = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    for (const m of line.matchAll(re)) {
        const idx = m.index ?? 0;
        if (idx > last) parts.push({ text: line.slice(last, idx), bold: false });
        parts.push({ text: m[1], bold: true });
        last = idx + m[0].length;
    }
    if (last < line.length) parts.push({ text: line.slice(last), bold: false });
    return parts;
}
