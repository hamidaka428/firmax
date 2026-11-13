// app/lib/default-templates.ts
// Sample templates added automatically to every company the first time "Templates" is opened.
// They are examples only — users should review them (ideally with a lawyer) and adapt them to their jurisdiction.

import type { ContractType } from './types';

export interface DefaultTemplate {
    name: string;
    contract_type: ContractType;
    default_title: string;
    default_months: number | null;
    body: string;
}

const PARTIES = `This agreement is made on {{contract.start}} between:

**{{company.name}}**, registration no. {{company.reg_no}}, with its registered address at {{company.address}}, {{company.country}}, represented by {{company.representative}}, hereinafter the **{{company.role}}**,

and

**{{client.name}}**, registration no./ID {{client.reg_no}}, with its address at {{client.address}}, {{client.country}}, represented by {{client.representative}}, hereinafter the **{{client.role}}**.

The parties agree as follows:`;

const FINAL = `## Final provisions

Any amendments to this agreement must be made in writing and signed by both parties.

Matters not covered by this agreement are governed by the law of the {{company.role}}'s country of registration. The parties will try to resolve disputes amicably; failing that, the competent courts at the {{company.role}}'s registered address have jurisdiction.

This agreement is signed in two identical counterparts, one for each party.`;

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
    {
        name: 'Sale of goods agreement',
        contract_type: 'sale',
        default_title: 'Supply of goods',
        default_months: null,
        body: `# SALE OF GOODS AGREEMENT
## No. {{contract.number}}

${PARTIES}

## 1. Subject

The SELLER sells and undertakes to deliver to the BUYER, and the BUYER buys and pays for, the following goods: {{contract.subject}}.

{{items_table}}

## 2. Price and payment

The total price is {{contract.amount}} ({{contract.amount_words}}) excluding VAT, or {{contract.amount_incl_vat}} ({{contract.amount_incl_vat_words}}) including VAT.

Payment is made by bank transfer to the SELLER's account: IBAN {{company.iban}}, BIC {{company.bic}}, {{company.bank}}, within 14 days of the invoice date.

## 3. Delivery and ownership

The SELLER delivers the goods within the time agreed between the parties; handover is confirmed by a signed delivery note.

Ownership and the risk of accidental loss pass to the BUYER upon handover of the goods.

## 4. Warranty and complaints

The BUYER inspects the goods upon receipt. Visible defects must be reported in writing within 3 working days, hidden defects within 14 days of discovery.

The SELLER replaces or repairs defective goods at its own expense, or refunds the price of the defective goods.

${FINAL}`,
    },
    {
        name: 'Equipment rental agreement',
        contract_type: 'rental',
        default_title: 'Equipment rental',
        default_months: 12,
        body: `# EQUIPMENT RENTAL AGREEMENT
## No. {{contract.number}}

${PARTIES}

## 1. Subject

The LESSOR provides the LESSEE with temporary use of the following equipment for a fee: {{contract.subject}}.

{{items_table}}

## 2. Term

The agreement is concluded for {{contract.term}}, from {{contract.start}} to {{contract.end}}.

## 3. Rent and payment

The rent is {{contract.amount}} ({{contract.amount_words}}) excluding VAT for the whole term, or {{contract.amount_incl_vat}} including VAT.

The rent is paid monthly in advance by bank transfer to IBAN {{company.iban}}, {{company.bank}}, against an invoice issued by the LESSOR.

## 4. Obligations of the parties

The LESSOR hands over the equipment in good working order, together with its documentation, and is responsible for repairs not caused by the LESSEE.

The LESSEE uses the equipment with due care and only for its intended purpose, does not sublet it without written consent and returns it at the end of the term in the condition it was received, allowing for normal wear and tear.

## 5. Termination

Either party may terminate the agreement with 30 days' written notice. The LESSOR may terminate without notice if the rent is more than 30 days overdue.

${FINAL}`,
    },
    {
        name: 'Service agreement',
        contract_type: 'service',
        default_title: 'Provision of services',
        default_months: 12,
        body: `# SERVICE AGREEMENT
## No. {{contract.number}}

${PARTIES}

## 1. Subject

The CUSTOMER engages, and the CONTRACTOR agrees to provide, the following services: {{contract.subject}}.

{{items_table}}

## 2. Term

The services are provided for {{contract.term}}, from {{contract.start}} to {{contract.end}}.

## 3. Fee and payment

The fee is {{contract.amount}} ({{contract.amount_words}}) excluding VAT, or {{contract.amount_incl_vat}} including VAT.

Payment is made by bank transfer to IBAN {{company.iban}}, {{company.bank}}, within 14 days of the invoice date.

## 4. Obligations of the parties

The CONTRACTOR provides the services professionally, on time and in accordance with the CUSTOMER's reasonable instructions.

The CUSTOMER provides the information and access needed to perform the services and pays the agreed fee on time.

## 5. Confidentiality

Each party keeps confidential any information about the other party received in connection with this agreement, during its term and for 2 years afterwards.

${FINAL}`,
    },
];
