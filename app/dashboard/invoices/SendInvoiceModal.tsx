'use client';

import SendDocumentModal from '@/app/components/SendDocumentModal';
import type { ShareState } from '@/app/components/SendDocumentModal';
import { DOC_LABEL } from '@/app/lib/documents';
import { formatDate, formatMoney } from '@/app/lib/format';
import type { Invoice } from '@/app/lib/types';
import { getInvoiceLink, revokeInvoiceLink, sendInvoiceEmail } from './share-actions';

export default function SendInvoiceModal({
    invoice,
    clientEmail,
    companyName,
    currency,
    origin,
    onClose,
    onChanged,
}: {
    invoice: Invoice;
    clientEmail: string;
    companyName: string;
    currency: string;
    origin: string;
    onClose: () => void;
    onChanged: (r: { id: number; patch: Partial<ShareState> }) => void;
}) {
    const label = DOC_LABEL[invoice.doc_type];
    return (
        <SendDocumentModal
            title={`Send — ${label.toLowerCase()} no. ${invoice.invoice_number}`}
            description={`To ${invoice.client_name}. The client receives an email with a link where they can view, print or save the document as a PDF.`}
            state={invoice}
            clientEmail={clientEmail}
            defaultMessage={`Hello,\n\nPlease find ${label.toLowerCase()} no. ${invoice.invoice_number} dated ${formatDate(invoice.issue_date)} for ${formatMoney(invoice.total_amount, currency)} at the link below.\n\nBest regards,\n${companyName}`}
            sentToast={`${label} no. ${invoice.invoice_number} sent`}
            origin={origin}
            pathPrefix="/i/"
            actions={{
                send: (input) => sendInvoiceEmail(invoice.id, input),
                link: () => getInvoiceLink(invoice.id),
                revoke: () => revokeInvoiceLink(invoice.id),
            }}
            onClose={onClose}
            onChanged={(patch) => onChanged({ id: invoice.id, patch })}
        />
    );
}
