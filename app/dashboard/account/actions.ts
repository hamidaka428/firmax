'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { query, withTransaction } from '@/app/lib/db';
import {
    destroyOtherSessions,
    destroySession,
    hashPassword,
    requireUser,
    validatePassword,
    verifyPassword,
} from '@/app/lib/auth';
import { deleteStoredFile } from '@/app/lib/storage';
import { passwordChangedEmail } from '@/app/lib/email';

export interface FormState {
    error: string | null;
    success?: string | null;
}

/* ----------------------------------------------------------------------------
 * Profile
 * ------------------------------------------------------------------------- */

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
    const user = await requireUser();
    const name = String(formData.get('name') ?? '').trim();
    if (!name || name.length > 150) return { error: 'Enter a name (up to 150 characters).' };
    await query(`UPDATE users SET name = $1 WHERE id = $2`, [name, user.id]);
    revalidatePath('/dashboard', 'layout');
    return { error: null, success: 'Name saved.' };
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
    const user = await requireUser();
    const current = String(formData.get('current') ?? '');
    const next = String(formData.get('next') ?? '');
    const next2 = String(formData.get('next2') ?? '');

    const row = await query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (!(await verifyPassword(current, row.rows[0]?.password_hash ?? ''))) return { error: 'Your current password is wrong.' };
    const invalid = validatePassword(next);
    if (invalid) return { error: invalid };
    if (next !== next2) return { error: 'The new passwords do not match.' };
    if (next === current) return { error: 'The new password must be different from the current one.' };

    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await hashPassword(next), user.id]);
    await destroyOtherSessions(user.id);
    await passwordChangedEmail(user.email, user.name);
    return { error: null, success: 'Password changed. You were signed out of all other devices.' };
}

/**
 * Deletes the account and ALL data (right to erasure, Art. 17 GDPR):
 * companies, clients, contracts, invoices, uploaded files.
 */
export async function deleteAccount(_prev: FormState, formData: FormData): Promise<FormState> {
    const user = await requireUser();
    const password = String(formData.get('password') ?? '');
    const confirmText = String(formData.get('confirm') ?? '').trim();
    if (confirmText !== 'DELETE') return { error: 'Type DELETE (in capitals) to confirm.' };

    const row = await query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (!(await verifyPassword(password, row.rows[0]?.password_hash ?? ''))) return { error: 'Wrong password.' };

    let files: string[] = [];
    try {
        files = await withTransaction(async (client) => {
            const paths = await client.query<{ p: string }>(
                `SELECT file_path AS p FROM contracts WHERE file_path IS NOT NULL AND company_id IN (SELECT id FROM companies WHERE owner_id = $1)
                 UNION ALL
                 SELECT file_path FROM invoices WHERE file_path IS NOT NULL AND company_id IN (SELECT id FROM companies WHERE owner_id = $1)
                 UNION ALL
                 SELECT logo_path FROM companies WHERE logo_path IS NOT NULL AND owner_id = $1`,
                [user.id],
            );
            // Deletion order: documents → companies (cascades to clients, inventory, templates) → user (cascades to sessions)
            await client.query(`DELETE FROM invoices  WHERE company_id IN (SELECT id FROM companies WHERE owner_id = $1)`, [user.id]);
            await client.query(`DELETE FROM contracts WHERE company_id IN (SELECT id FROM companies WHERE owner_id = $1)`, [user.id]);
            await client.query(`DELETE FROM companies WHERE owner_id = $1`, [user.id]);
            await client.query(`DELETE FROM users WHERE id = $1`, [user.id]);
            return paths.rows.map((r) => r.p);
        });
    } catch (error) {
        console.error('deleteAccount', error);
        return { error: 'Deletion failed. Nothing was deleted — please try again.' };
    }

    await Promise.all(files.map((f) => deleteStoredFile(f)));
    await destroySession();
    redirect('/?deleted=1');
}
