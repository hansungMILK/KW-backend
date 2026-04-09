import { log } from '../utils/logger';

/**
 * Bootstrap layer — loads domain packs based on DOMAIN_PACKS env.
 *
 * Initialization rules:
 * - Idempotent: safe to call multiple times (guarded by _initPromise)
 * - Fail-fast: if a pack fails to load, _initPromise resets → next call retries
 * - Called from BOTH HTTP middleware AND queue worker processLocally()
 *   so all execution paths share the same init
 */

let _initPromise: Promise<void> | null = null;

export function initDomainPacks(): Promise<void> {
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        const packs = (process.env.DOMAIN_PACKS || 'shorts-pack')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        // Load all packs — if ANY fails, reset promise so next call retries
        try {
            for (const pack of packs) {
                switch (pack) {
                    case 'shorts-pack': {
                        const { registerShortsPack } = require('../modules/domain-packs/shorts-pack');
                        await registerShortsPack(); // throws on startup validation failure
                        log.info(`Domain pack loaded: ${pack}`);
                        break;
                    }
                    default:
                        // Unknown pack is a hard error — misconfiguration should be visible
                        throw new Error(`Unknown domain pack: "${pack}". Check DOMAIN_PACKS env.`);
                }
            }
        } catch (err) {
            // Reset so next invocation can retry
            _initPromise = null;
            throw err;
        }
    })();

    return _initPromise;
}
