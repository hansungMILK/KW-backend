import { log } from '../../utils/logger';

import type { Orchestrator } from './types';

export type { Orchestrator, ProposalResult } from './types';

/**
 * Orchestrator registry — domain-agnostic, SINGLE ACTIVE PLANNING PACK.
 *
 * Design decision:
 *   Currently only ONE orchestrator can be active at a time.
 *   This is intentional — multiple planning packs would need a routing
 *   layer to decide which planner handles which request.
 *   That's a P5D+ concern. For now, last-registered wins with a warning.
 *
 * Block registry supports multiple packs (additive — blocks accumulate).
 * Orchestrator is singular (only one planner drives proposal generation).
 */

let _registeredOrchestrator: Orchestrator | null = null;
let _registeredPackName: string | null = null;

/**
 * Register an orchestrator from a domain pack.
 * If another pack already registered one, logs a warning and overwrites.
 */
export function registerOrchestrator(orchestrator: Orchestrator, packName?: string): void {
    if (_registeredOrchestrator && _registeredPackName) {
        log.warn(
            `Orchestrator already registered by "${_registeredPackName}", overwriting with "${packName || 'unknown'}"`
        );
    }
    _registeredOrchestrator = orchestrator;
    _registeredPackName = packName || 'unknown';
    log.info(`Orchestrator registered by pack: ${_registeredPackName}`);
}

/** Get the active orchestrator. Returns empty fallback if none registered. */
export const getOrchestrator = async (): Promise<Orchestrator> => {
    if (_registeredOrchestrator) return _registeredOrchestrator;

    log.warn('No orchestrator registered by any domain pack');
    return {
        async generateProposal() {
            return {
                proposedNodes: [],
                proposedEdges: [],
                estimatedCost: { currency: 'USD', total: 0 },
                approvalRequired: false,
                assistantMessage: 'No domain pack with planning capability is loaded. Configure DOMAIN_PACKS.',
            };
        },
    };
};
