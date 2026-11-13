'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Building2, Trash2, Upload } from 'lucide-react';
import { useToast } from '@/app/components/ui/ToastProvider';
import { useConfirm } from '@/app/components/ui/ConfirmDialog';
import { btnPrimary, btnSecondary, cardCls } from '@/app/components/ui/styles';
import { removeCompanyLogo, uploadCompanyLogo } from './actions';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif';

export default function LogoCard({
    companyName,
    initialLogoUrl,
}: {
    companyName: string;
    initialLogoUrl: string | null;
}) {
    const toast = useToast();
    const confirm = useConfirm();
    const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
    const [busy, setBusy] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    async function upload(file: File) {
        if (!/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
            toast.error('Unsupported format', 'Choose a PNG, JPG, WEBP or GIF image.');
            return;
        }
        if (file.size > MAX_LOGO_BYTES) {
            toast.error('File too large', 'The logo must be 2 MB or smaller.');
            return;
        }
        const fd = new FormData();
        fd.set('logo', file);
        setBusy(true);
        const res = await uploadCompanyLogo(fd);
        setBusy(false);
        if (!res.ok) {
            toast.error('Logo not uploaded', res.error);
            return;
        }
        setLogoUrl(`/api/files/${res.data.logo_path}`);
        toast.success('Logo uploaded', 'It will appear on invoices and contracts.');
    }

    function onPick(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void upload(file);
    }

    function onDrop(e: DragEvent<HTMLDivElement>) {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void upload(file);
    }

    async function onRemove() {
        const ok = await confirm({
            title: 'Remove logo',
            message: 'The logo will disappear from invoices and contracts (including when reprinting old documents).',
            confirmLabel: 'Remove',
            tone: 'danger',
        });
        if (!ok) return;
        setBusy(true);
        const res = await removeCompanyLogo();
        setBusy(false);
        if (!res.ok) return toast.error('Could not remove the logo', res.error);
        setLogoUrl(null);
        toast.success('Logo removed');
    }

    return (
        <section className={`${cardCls} p-6`}>
            <h2 className="text-lg font-semibold text-slate-100">Company logo</h2>
            <p className="mt-0.5 text-sm text-slate-400">Shown in the top-left corner of invoices and contracts and in the company switcher.</p>

            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
                <div
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    className={`flex h-32 w-full shrink-0 items-center justify-center rounded-xl border-2 border-dashed bg-white p-3 transition-colors sm:w-64 ${
                        dragOver ? 'border-indigo-400' : 'border-slate-700'
                    }`}
                >
                    {logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the file comes from a protected API route
                        <img src={logoUrl} alt={`${companyName} logo`} className="max-h-full max-w-full object-contain" />
                    ) : (
                        <div className="flex flex-col items-center gap-1 text-center text-xs text-slate-500">
                            <Building2 className="h-7 w-7 text-slate-400" />
                            Drop an image here
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                    <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={btnPrimary}>
                            <Upload className="h-4 w-4" />
                            {busy ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
                        </button>
                        {logoUrl ? (
                            <button type="button" onClick={onRemove} disabled={busy} className={btnSecondary}>
                                <Trash2 className="h-4 w-4" />
                                Remove
                            </button>
                        ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-slate-500">
                        PNG, JPG, WEBP or GIF, up to 2 MB. A horizontal logo on a transparent or white background works best
                        (e.g. 600 × 200 px).
                    </p>
                </div>
            </div>
        </section>
    );
}
