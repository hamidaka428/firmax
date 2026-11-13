// app/lib/numbering.ts
// Document numbering (inside a transaction).
//   'main'      — the main series (companies.invoice_seq, function next_invoice_number)
//   's<id>'     — an additional series from invoice_series
//   'proforma'  — proformas (separate sequence, not tax documents)
// Invoices and notes in one series share the sequence. Numbers must not overlap between series.

import type { DbClient } from './db';
import type { DocType } from './types';

export class NumberingError extends Error {}

export function seriesKeyFor(seriesId: number | null): string {
    return seriesId ? `s${seriesId}` : 'main';
}

export function seriesIdFromKey(key: string): number | null {
    const m = /^s(\d+)$/.exec(key);
    return m ? Number(m[1]) : null;
}

/** Next number in the series. Returns the number and the series key. */
export async function assignNumber(
    client: DbClient,
    companyId: number,
    docType: DocType,
    seriesKey = 'main',
): Promise<{ number: string; seriesKey: string }> {
    if (docType === 'proforma') {
        const r = await client.query<{ n: string }>(`SELECT next_proforma_number($1) AS n`, [companyId]);
        return { number: r.rows[0].n, seriesKey: 'proforma' };
    }

    const seriesId = seriesIdFromKey(seriesKey);
    let number: string;
    if (seriesId === null) {
        const r = await client.query<{ n: string }>(`SELECT next_invoice_number($1) AS n`, [companyId]);
        number = r.rows[0].n;
        seriesKey = 'main';
    } else {
        const r = await client.query<{ n: string; name: string }>(
            `UPDATE invoice_series SET next_number = next_number + 1
              WHERE id = $1 AND company_id = $2 AND next_number < 9999999999
              RETURNING LPAD((next_number - 1)::text, 10, '0') AS n, name`,
            [seriesId, companyId],
        );
        if (!r.rows[0]) throw new NumberingError('The selected number series does not exist or is exhausted.');
        number = r.rows[0].n;
    }

    // Overlap guard: the number must not already be used in another series of the company
    const clash = await client.query(
        `SELECT 1 FROM invoices WHERE company_id = $1 AND invoice_number = $2 AND series_key <> 'proforma' LIMIT 1`,
        [companyId, number],
    );
    if (clash.rows.length > 0) {
        throw new NumberingError(
            `Number ${number} is already used in another series. Change the series start number in Settings so the ranges do not overlap.`,
        );
    }
    return { number, seriesKey };
}
