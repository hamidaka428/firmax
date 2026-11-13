// app/lib/rate-limit.ts
// Simple in-memory attempt limiter: after N failures a key is locked for X minutes.
// Enough for a single server; multiple instances need a shared store (e.g. Redis).

import { headers } from 'next/headers';

interface Entry {
    count: number;
    until: number;
}

const store = ((globalThis as unknown as { __erpRateLimit?: Map<string, Entry> }).__erpRateLimit ??= new Map());

export async function clientIp(): Promise<string> {
    const h = await headers();
    return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'local').trim();
}

/** Minutes left until unlocked (0 = not locked). */
export function lockedMinutes(key: string, max: number, now = Date.now()): number {
    const entry = store.get(key);
    if (!entry) return 0;
    if (entry.until <= now) {
        store.delete(key);
        return 0;
    }
    return entry.count >= max ? Math.ceil((entry.until - now) / 60_000) : 0;
}

export function registerFailure(key: string, windowMinutes: number, now = Date.now()): void {
    const entry = store.get(key);
    const count = entry && entry.until > now ? entry.count + 1 : 1;
    store.set(key, { count, until: now + windowMinutes * 60_000 });
    // keep the map from growing forever
    if (store.size > 10_000) {
        for (const [k, v] of store) if (v.until <= now) store.delete(k);
    }
}

export function clearFailures(key: string): void {
    store.delete(key);
}
