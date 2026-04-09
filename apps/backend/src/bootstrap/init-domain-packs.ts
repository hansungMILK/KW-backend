import { log } from '../utils/logger';

/**
 * Bootstrap layer — loads domain packs based on configuration.
 * This is the ONLY place that knows about specific domain packs.
 * Called once on app startup, before any handler runs.
 *
 * middleware.ts, execution-engine.ts, etc. do NOT import domain packs.
 */

let _initialized = false;

export function initDomainPacks(): void {
    if (_initialized) return;
    _initialized = true;

    const packs = (process.env.DOMAIN_PACKS || 'shorts-pack')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    for (const pack of packs) {
        try {
            switch (pack) {
                case 'shorts-pack': {
                    // Dynamic import to keep this as the only coupling point
                     
                    const { registerShortsPack } = require('../modules/domain-packs/shorts-pack');
                    registerShortsPack();
                    log.info(`Domain pack loaded: ${pack}`);
                    break;
                }
                default:
                    log.warn(`Unknown domain pack: ${pack}, skipping`);
            }
        } catch (err) {
            log.error(`Failed to load domain pack: ${pack}`, err);
        }
    }
}
