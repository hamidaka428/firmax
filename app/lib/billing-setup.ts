// app/lib/billing-setup.ts
// Loads the company's additional bank accounts and number series.

import { query } from './db';
import type { BankAccount, InvoiceSeries } from './types';

export async function loadBankAccounts(companyId: number): Promise<BankAccount[]> {
    const res = await query<BankAccount>(
        `SELECT b.id, b.label, b.bank_name, b.iban, b.bic,
                (SELECT COUNT(*) FROM invoices i WHERE i.bank_account_id = b.id)::int AS invoices
           FROM bank_accounts b WHERE b.company_id = $1 ORDER BY b.id`,
        [companyId],
    );
    return res.rows;
}

export async function loadInvoiceSeries(companyId: number): Promise<InvoiceSeries[]> {
    const res = await query<InvoiceSeries>(
        `SELECT s.id, s.name, s.next_number,
                (SELECT COUNT(*) FROM invoices i WHERE i.company_id = s.company_id AND i.series_key = 's' || s.id)::int AS invoices
           FROM invoice_series s WHERE s.company_id = $1 ORDER BY s.id`,
        [companyId],
    );
    return res.rows;
}
