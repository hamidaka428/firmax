'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/app/lib/db';
import { getActiveCompanyId } from '@/app/lib/tenant';
import { round } from '@/app/lib/format';
import type { ActionResult, Product, ProductInput } from '@/app/lib/types';

const PRODUCT_COLUMNS = `id, COALESCE(sku, '') AS sku, name, category, unit, qty_in_stock, min_stock_level, unit_price`;

function refresh() {
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/warehouse');
}

function isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

function fail(error: unknown, fallback: string): { ok: false; error: string } {
    if (isUniqueViolation(error)) {
        return { ok: false, error: 'A product with this SKU already exists in your inventory.' };
    }
    console.error(fallback, error);
    return { ok: false, error: fallback };
}

function toNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Validates untrusted input from the client. */
function parseInput(raw: unknown): { ok: true; value: ProductInput } | { ok: false; error: string } {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Invalid data.' };
    const r = raw as Record<string, unknown>;

    const sku = typeof r.sku === 'string' ? r.sku.trim() : '';
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const category = typeof r.category === 'string' && r.category.trim() ? r.category.trim() : 'General';
    const unit = typeof r.unit === 'string' && r.unit.trim() ? r.unit.trim() : 'pcs';
    const qty = toNumber(r.qty_in_stock);
    const min = toNumber(r.min_stock_level);
    const price = toNumber(r.unit_price);

    if (!sku) return { ok: false, error: 'SKU is required.' };
    if (!name) return { ok: false, error: 'Name is required.' };
    if (sku.length > 50 || name.length > 255 || category.length > 100 || unit.length > 20) {
        return { ok: false, error: 'One of the fields is too long.' };
    }
    if (qty === null || min === null || price === null) {
        return { ok: false, error: 'Quantities and price must be non-negative numbers.' };
    }

    return {
        ok: true,
        value: {
            sku,
            name,
            category,
            unit,
            qty_in_stock: round(qty, 3),
            min_stock_level: round(min, 3),
            unit_price: round(price, 2),
        },
    };
}

export async function createProduct(raw: ProductInput): Promise<ActionResult<Product>> {
    const parsed = parseInput(raw);
    if (!parsed.ok) return parsed;
    const p = parsed.value;

    try {
        const companyId = await getActiveCompanyId();
        const res = await query<Product>(
            `INSERT INTO products (company_id, sku, name, category, unit, qty_in_stock, min_stock_level, unit_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING ${PRODUCT_COLUMNS}`,
            [companyId, p.sku, p.name, p.category, p.unit, p.qty_in_stock, p.min_stock_level, p.unit_price],
        );
        refresh();
        return { ok: true, data: res.rows[0] };
    } catch (error) {
        return fail(error, 'Failed to create the product.');
    }
}

export async function updateProduct(id: number, raw: ProductInput): Promise<ActionResult<Product>> {
    const parsed = parseInput(raw);
    if (!parsed.ok) return parsed;
    const p = parsed.value;

    try {
        const companyId = await getActiveCompanyId();
        const res = await query<Product>(
            `UPDATE products
                SET sku = $1, name = $2, category = $3, unit = $4,
                    qty_in_stock = $5, min_stock_level = $6, unit_price = $7
              WHERE id = $8 AND company_id = $9
              RETURNING ${PRODUCT_COLUMNS}`,
            [p.sku, p.name, p.category, p.unit, p.qty_in_stock, p.min_stock_level, p.unit_price, id, companyId],
        );
        if (res.rows.length === 0) return { ok: false, error: 'Product not found.' };
        refresh();
        return { ok: true, data: res.rows[0] };
    } catch (error) {
        return fail(error, 'Failed to save the product.');
    }
}

/** Atomic stock change (+/-). Never allows negative stock. */
export async function adjustProductQuantity(id: number, delta: number): Promise<ActionResult<{ qty_in_stock: number }>> {
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1_000_000) {
        return { ok: false, error: 'Invalid quantity change.' };
    }

    try {
        const companyId = await getActiveCompanyId();
        const res = await query<{ qty_in_stock: number }>(
            `UPDATE products SET qty_in_stock = qty_in_stock + $1
              WHERE id = $2 AND company_id = $3 AND qty_in_stock + $1 >= 0
              RETURNING qty_in_stock`,
            [delta, id, companyId],
        );
        if (res.rows.length === 0) return { ok: false, error: "Insufficient stock or the product doesn't exist." };
        revalidatePath('/dashboard');
        return { ok: true, data: res.rows[0] };
    } catch (error) {
        return fail(error, 'Failed to change the stock level.');
    }
}

export async function setProductQuantity(id: number, qty: number): Promise<ActionResult<{ qty_in_stock: number }>> {
    const value = toNumber(qty);
    if (value === null) return { ok: false, error: 'Quantity must be a non-negative number.' };

    try {
        const companyId = await getActiveCompanyId();
        const res = await query<{ qty_in_stock: number }>(
            `UPDATE products SET qty_in_stock = $1 WHERE id = $2 AND company_id = $3 RETURNING qty_in_stock`,
            [round(value, 3), id, companyId],
        );
        if (res.rows.length === 0) return { ok: false, error: 'Product not found.' };
        revalidatePath('/dashboard');
        return { ok: true, data: res.rows[0] };
    } catch (error) {
        return fail(error, 'Failed to change the quantity.');
    }
}

export async function setProductPrice(id: number, price: number): Promise<ActionResult<{ unit_price: number }>> {
    const value = toNumber(price);
    if (value === null) return { ok: false, error: 'Price must be a non-negative number.' };

    try {
        const companyId = await getActiveCompanyId();
        const res = await query<{ unit_price: number }>(
            `UPDATE products SET unit_price = $1 WHERE id = $2 AND company_id = $3 RETURNING unit_price`,
            [round(value, 2), id, companyId],
        );
        if (res.rows.length === 0) return { ok: false, error: 'Product not found.' };
        revalidatePath('/dashboard');
        return { ok: true, data: res.rows[0] };
    } catch (error) {
        return fail(error, 'Failed to change the price.');
    }
}

export async function deleteProduct(id: number): Promise<ActionResult> {
    try {
        const companyId = await getActiveCompanyId();
        const res = await query(`DELETE FROM products WHERE id = $1 AND company_id = $2`, [id, companyId]);
        if (res.rowCount === 0) return { ok: false, error: 'Product not found.' };
        refresh();
        return { ok: true, data: undefined };
    } catch (error) {
        return fail(error, 'Failed to delete the product.');
    }
}
