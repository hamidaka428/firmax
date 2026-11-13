import { query } from '@/app/lib/db';
import { requireActiveCompany } from '@/app/lib/tenant';
import type { Product } from '@/app/lib/types';
import WarehouseTable from './WarehouseTable';

export const metadata = { title: 'Inventory' };

export default async function WarehousePage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const filter = Array.isArray(params.filter) ? params.filter[0] : params.filter;

    const company = await requireActiveCompany();
    const res = await query<Product>(
        `SELECT id, COALESCE(sku, '') AS sku, name, category, unit, qty_in_stock, min_stock_level, unit_price
           FROM products
          WHERE company_id = $1
          ORDER BY category ASC, name ASC`,
        [company.id],
    );

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-100">Inventory</h1>
                <p className="mt-1 text-sm text-slate-400">
                    Click a quantity or price to edit it inline. The − and + buttons change the stock by 1.
                </p>
            </div>

            <WarehouseTable
                key={company.id}
                initialProducts={res.rows}
                currency={company.currency}
                initialCritical={filter === 'critical'}
            />
        </div>
    );
}
