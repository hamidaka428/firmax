// app/lib/app.ts
// App-wide settings: name, tagline and the public URL.

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Firmax';
export const APP_TAGLINE = 'Invoicing, contracts and inventory for small businesses';

/** Source code repository, linked from the landing page. */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL || 'https://github.com/hamidaka428/firmax';

/** Public URL of this installation, without a trailing slash (used in email links). */
export function appUrl(): string {
    return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}
