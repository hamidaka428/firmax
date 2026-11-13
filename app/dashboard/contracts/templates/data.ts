import { SQL_TZ } from '@/app/lib/format';
import { query, withTransaction } from '@/app/lib/db';
import { DEFAULT_TEMPLATES } from '@/app/lib/default-templates';
import type { ContractTemplate } from '@/app/lib/types';

const TEMPLATE_COLUMNS = `t.id, t.name, t.contract_type, t.default_title, t.default_months, t.body,
       to_char(t.updated_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD') AS updated_at,
       (SELECT COUNT(*) FROM contracts c WHERE c.template_id = t.id)::int AS contract_count`;

/**
 * On first open, adds the sample templates to the company (only once —
 * if the user deletes them, they don't come back).
 */
async function ensureDefaultTemplates(companyId: number): Promise<void> {
    const flag = await query<{ templates_seeded: boolean }>(`SELECT templates_seeded FROM companies WHERE id = $1`, [companyId]);
    if (flag.rows.length === 0 || flag.rows[0].templates_seeded) return;

    await withTransaction(async (client) => {
        // FOR UPDATE: two concurrent requests won't add the templates twice
        const lock = await client.query<{ templates_seeded: boolean }>(
            `SELECT templates_seeded FROM companies WHERE id = $1 FOR UPDATE`,
            [companyId],
        );
        if (lock.rows[0]?.templates_seeded) return;
        for (const t of DEFAULT_TEMPLATES) {
            await client.query(
                `INSERT INTO contract_templates (company_id, name, contract_type, default_title, default_months, body)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [companyId, t.name, t.contract_type, t.default_title, t.default_months, t.body],
            );
        }
        await client.query(`UPDATE companies SET templates_seeded = true WHERE id = $1`, [companyId]);
    });
}

export async function loadTemplates(companyId: number, onlyId?: number): Promise<ContractTemplate[]> {
    await ensureDefaultTemplates(companyId);
    const params: unknown[] = [companyId];
    let extra = '';
    if (onlyId !== undefined) {
        params.push(onlyId);
        extra = 'AND t.id = $2';
    }
    const res = await query<ContractTemplate>(
        `SELECT ${TEMPLATE_COLUMNS}
           FROM contract_templates t
          WHERE t.company_id = $1 ${extra}
          ORDER BY t.name ASC, t.id ASC`,
        params,
    );
    return res.rows;
}
