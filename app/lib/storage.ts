import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

/** Root for uploaded files: ./storage/uploads (outside /public, served only via /api/files/...). */
export const STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'uploads');
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

export type UploadKind = 'contracts' | 'invoices' | 'logos';

export interface UploadOptions {
    /** Max size in bytes (default 15 MB) */
    maxBytes?: number;
    /** Images only (for logos) */
    imagesOnly?: boolean;
}

const MIME_BY_EXT: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};

export function mimeFromFileName(fileName: string): string | null {
    return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? null;
}

/** Checks the "magic bytes" so a .pdf that is actually something else is rejected. */
function matchesSignature(buf: Buffer, ext: string): boolean {
    switch (ext) {
        case '.pdf':
            return buf.subarray(0, 5).toString('latin1') === '%PDF-';
        case '.png':
            return buf.length > 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG';
        case '.jpg':
        case '.jpeg':
            return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        case '.gif':
            return buf.subarray(0, 4).toString('latin1') === 'GIF8';
        case '.webp':
            return buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
        default:
            return false;
    }
}

/**
 * Turns a relative path from the database (e.g. "contracts/ab12.pdf") into an absolute path on disk.
 * Returns null on any attempt to escape STORAGE_ROOT (path traversal).
 */
export function resolveStoredPath(relativePath: string): string | null {
    if (!relativePath || relativePath.includes('\0') || relativePath.includes('\\')) return null;
    const segments = relativePath.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;

    const absolute = path.resolve(STORAGE_ROOT, ...segments);
    if (!absolute.startsWith(STORAGE_ROOT + path.sep)) return null;
    return absolute;
}

export interface SavedUpload {
    filePath: string; // relative path for the file_path column
    fileName: string; // original name for the file_name column
}

/** Saves an uploaded file (File from FormData) after validating size, extension and content. */
export async function saveUpload(kind: UploadKind, file: File, options: UploadOptions = {}): Promise<SavedUpload> {
    const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
    if (!file || file.size === 0) {
        throw new Error('No file selected.');
    }
    if (file.size > maxBytes) {
        throw new Error(`The file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!MIME_BY_EXT[ext] || (options.imagesOnly && ext === '.pdf')) {
        throw new Error(options.imagesOnly ? 'Only PNG, JPG, WEBP and GIF images are allowed.' : 'Only PDF, PNG, JPG, WEBP and GIF files are allowed.');
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!matchesSignature(buffer, ext)) {
        throw new Error("The file content doesn't match its extension.");
    }

    const dir = path.join(STORAGE_ROOT, kind);
    await mkdir(dir, { recursive: true });

    const storedName = `${randomUUID()}${ext}`;
    await writeFile(path.join(dir, storedName), buffer);

    return {
        filePath: `${kind}/${storedName}`,
        fileName: path.basename(file.name).slice(0, 255),
    };
}

/** Deletes a file from disk (silently ignores a missing file). */
export async function deleteStoredFile(relativePath: string | null | undefined): Promise<void> {
    if (!relativePath) return;
    const absolute = resolveStoredPath(relativePath);
    if (!absolute) return;
    try {
        await unlink(absolute);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('Failed to delete file:', error);
        }
    }
}
