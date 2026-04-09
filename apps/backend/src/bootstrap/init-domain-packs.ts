import { log } from '../utils/logger';

/**
 * Bootstrap layer — loads domain packs based on DOMAIN_PACKS env.
 *
 * Initialization rules:
 * - Idempotent: safe to call multiple times
 * - Fail-fast: if a pack fails to load, _initialized stays false → next call retries
 * - Called from BOTH HTTP middleware AND queue worker processLocally()
 *   so all execution paths share the same init
 */

let _initialized = false;

export function initDomainPacks(): void {
    if (_initialized) return;

    const packs = (process.env.DOMAIN_PACKS || 'shorts-pack')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    // Load all packs — if ANY fails, don't mark as initialized (allow retry)
    for (const pack of packs) {
        switch (pack) {
            case 'shorts-pack': {
                 
                const { registerShortsPack } = require('../modules/domain-packs/shorts-pack');
                registerShortsPack(); // throws on startup validation failure
                log.info(`Domain pack loaded: ${pack}`);
                break;
            }
            default:
                // Unknown pack is a hard error — misconfiguration should be visible
                throw new Error(`Unknown domain pack: "${pack}". Check DOMAIN_PACKS env.`);
        }
    }

    // Only mark initialized AFTER all packs loaded successfully
    _initialized = true;
}
