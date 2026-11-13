'use client';

import { Download } from 'lucide-react';
import { Modal } from '@/app/components/ui/Modal';
import { btnPrimary, btnSecondary } from '@/app/components/ui/styles';

interface FilePreviewModalProps {
    filePath: string | null;
    fileName: string | null;
    title: string;
    onClose: () => void;
}

export function fileUrl(filePath: string, download = false): string {
    return `/api/files/${filePath}${download ? '?download=1' : ''}`;
}

export default function FilePreviewModal({ filePath, fileName, title, onClose }: FilePreviewModalProps) {
    const isPdf = filePath ? /\.pdf$/i.test(filePath) : false;
    const isImage = filePath ? /\.(png|jpe?g|gif|webp)$/i.test(filePath) : false;

    return (
        <Modal
            open={filePath !== null}
            onClose={onClose}
            title={fileName ?? 'File preview'}
            description={title}
            size="2xl"
            footer={
                <>
                    {filePath ? (
                        <a href={fileUrl(filePath, true)} className={btnPrimary}>
                            <Download className="h-4 w-4" />
                            Download
                        </a>
                    ) : null}
                    <button type="button" className={btnSecondary} onClick={onClose}>
                        Close
                    </button>
                </>
            }
        >
            {filePath && isPdf ? (
                <iframe
                    title={fileName ?? 'PDF preview'}
                    src={fileUrl(filePath)}
                    className="h-[70vh] w-full rounded-lg border border-slate-800 bg-white"
                />
            ) : filePath && isImage ? (
                <div className="flex max-h-[70vh] justify-center overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrl(filePath)} alt={fileName ?? 'Attached file'} className="h-auto max-w-full object-contain" />
                </div>
            ) : (
                <p className="py-10 text-center text-sm text-slate-400">This file type can&apos;t be previewed. Download it instead.</p>
            )}
        </Modal>
    );
}
