// app/lib/labels.ts
// Display labels for the codes stored in the database.

import type { ContractStatus, ContractType, InvoiceStatus, PaymentMethod } from './types';

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
    pending: 'Pending',
    paid: 'Paid',
    cancelled: 'Cancelled',
};

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
    active: 'Active',
    completed: 'Completed',
};

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
    rental: 'Rental',
    sale: 'Sale',
    service: 'Service',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
    bank_transfer: 'Bank transfer',
    cash: 'Cash',
    card: 'Card',
};

/** Label for any invoice status string (falls back to the raw value). */
export function invoiceStatusLabel(status: string, overdue = false): string {
    if (overdue) return 'Overdue';
    return INVOICE_STATUS_LABEL[status as InvoiceStatus] ?? status;
}

/** Common units of measure (free text is also allowed). */
export const UNITS = ['pcs', 'h', 'day', 'month', 'kg', 't', 'm', 'm²', 'm³', 'l', 'box', 'pack', 'roll', 'set', 'service'] as const;
