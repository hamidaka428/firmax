'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/app/lib/db';
import { getActiveCompanyId } from '@/app/lib/tenant';
import { unknownFields } from '@/app/lib/contract-template';
import { CONTRACT_TYPES } from '@/app/lib/types';
import type { ActionResult, ContractTemplate, ContractTemplateInput, ContractType } from '@/app/lib/types';
import { loadTemplates } from './data';

const MAX_BODY = 100_000;

function parseTemplate(raw: unknown): { ok: true; value: ContractTemplateInput } | { ok: false; error: string } {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Invalid data.' };
    const r = raw as Record<string, unknown>;
    const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');

    const name = str('name');
    const default_title = str('default_title');
    const body = typeof r.body === 'string' ? r.body.replace(/\r\n?/g, '\n').trimEnd() : '';
    const contract_type = r.contract_type as ContractType;
    const months = r.default_months;
    const default_months = months === null || months === undefined || months === '' ? null : Number(months);

    if (!name) return { ok: false, error: 'Enter a template name.' };
    if (name.length > 150 || default_title.length > 255) return { ok: false, error: 'One of the fields is too long.' };
    if (!CONTRACT_TYPES.includes(contract_type)) return { ok: false, error: 'Invalid contract type.' };
    if (default_months !== null && (!Number.isInteger(default_months) || default_months < 1 || default_months > 600)) {
        return { ok: false, error: 'The term must be a whole number of months (1–600), or empty for open-ended.' };
    }
    if (!body.trim()) return { ok: false, error: 'The template text is empty.' };
    if (body.length > MAX_BODY) return { ok: false, error: 'The template text is too long (max. 100,000 characters).' };
    const unknown = unknownFields(body);
    if (unknown.length > 0) {
        return { ok: false, error: `Unknown fields: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Insert them from the field list.` };
    }
    return { ok: true, value: { name, contract_type, default_title, default_months, body } };
}

function refresh() {
    revalidatePath('/dashboard/contracts/templates');
    revalidatePath('/dashboard/contracts');
}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
    console.error(fallback, error);
    return { ok: false, error: fallback };
}

export async function createTemplate(raw: ContractTemplateInput): Promise<ActionResult<ContractTemplate>> {
    const parsed = parseTemplate(raw);
    if (!parsed.ok) return parsed;
    const t = parsed.value;
    try {
        const companyId = await getActiveCompanyId();
        const ins = await query<{ id: number }>(
            `INSERT INTO contract_templates (company_id, name, contract_type, default_title, default_months, body)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [companyId, t.name, t.contract_type, t.default_title, t.default_months, t.body],
        );
        const rows = await loadTemplates(companyId, ins.rows[0].id);
        refresh();
        return { ok: true, data: rows[0] };
    } catch (error) {
        return failure(error, 'Failed to create the template.');
    }
}

export async function updateTemplate(id: number, raw: ContractTemplateInput): Promise<ActionResult<ContractTemplate>> {
    const parsed = parseTemplate(raw);
    if (!parsed.ok) return parsed;
    const t = parsed.value;
    try {
        const companyId = await getActiveCompanyId();
        const upd = await query(
            `UPDATE contract_templates
                SET name = $1, contract_type = $2, default_title = $3, default_months = $4, body = $5, updated_at = now()
              WHERE id = $6 AND company_id = $7`,
            [t.name, t.contract_type, t.default_title, t.default_months, t.body, id, companyId],
        );
        if (upd.rowCount === 0) return { ok: false, error: 'Template not found.' };
        const rows = await loadTemplates(companyId, id);
        refresh();
        return { ok: true, data: rows[0] };
    } catch (error) {
        return failure(error, 'Failed to save the template.');
    }
}

/** Deletes a template. Contracts already created keep their text (template_id becomes NULL). */
export async function deleteTemplate(id: number): Promise<ActionResult> {
    try {
        const companyId = await getActiveCompanyId();
        const del = await query(`DELETE FROM contract_templates WHERE id = $1 AND company_id = $2`, [id, companyId]);
        if (del.rowCount === 0) return { ok: false, error: 'Template not found.' };
        refresh();
        return { ok: true, data: undefined };
    } catch (error) {
        return failure(error, 'Failed to delete the template.');
    }
}
