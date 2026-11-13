'use client';

import SendDocumentModal from '@/app/components/SendDocumentModal';
import type { ShareState } from '@/app/components/SendDocumentModal';
import type { Contract } from '@/app/lib/types';
import { getContractLink, revokeContractLink, sendContractEmail } from './share-actions';

export default function SendContractModal({
    contract,
    clientEmail,
    companyName,
    origin,
    onClose,
    onChanged,
}: {
    contract: Contract;
    clientEmail: string;
    companyName: string;
    origin: string;
    onClose: () => void;
    onChanged: (patch: Partial<ShareState>) => void;
}) {
    return (
        <SendDocumentModal
            title={`Send — contract no. ${contract.contract_number}`}
            description={`To ${contract.client_name}. The client receives an email with a link to the contract text, where they can print it or save it as a PDF.`}
            state={contract}
            clientEmail={clientEmail}
            defaultMessage={`Hello,\n\nPlease find contract no. ${contract.contract_number} — ${contract.title} at the link below. Kindly review it and return a signed copy.\n\nBest regards,\n${companyName}`}
            sentToast={`Contract no. ${contract.contract_number} sent`}
            origin={origin}
            pathPrefix="/c/"
            actions={{
                send: (input) => sendContractEmail(contract.id, input),
                link: () => getContractLink(contract.id),
                revoke: () => revokeContractLink(contract.id),
            }}
            onClose={onClose}
            onChanged={onChanged}
        />
    );
}
