import { log } from '../../utils/logger';

import type { Orchestrator } from './types';

export type { Orchestrator, ProposalResult } from './types';

/**
 * Orchestrator registry — domain-agnostic.
 *
 * Domain packs register their orchestrator at startup.
 * getOrchestrator() returns the registered one, or falls back to mock.
 *
 * Core orchestrator module does NOT import any domain pack.
 */

let _registeredOrchestrator: Orchestrator | null = null;

/** Called by domain packs to register their orchestrator implementation. */
export function registerOrchestrator(orchestrator: Orchestrator): void {
    _registeredOrchestrator = orchestrator;
    log.info('Orchestrator registered');
}

/** Get the active orchestrator. Falls back to mock if none registered. */
export const getOrchestrator = async (): Promise<Orchestrator> => {
    const mode = process.env.ORCHESTRATOR_MODE || 'mock';

    if (mode === 'mock') {
        // Mock orchestrator is part of shorts-pack but also useful standalone.
        // If a domain pack registered an orchestrator, use it for mock too.
        if (_registeredOrchestrator) return _registeredOrchestrator;
        // Ultimate fallback: inline minimal mock
        return {
            async generateProposal(_flowId: string, _userMessage: string) {
                return {
                    proposedNodes: [],
                    proposedEdges: [],
                    estimatedCost: { currency: 'USD', total: 0 },
                    approvalRequired: false,
                    assistantMessage: 'No domain pack loaded. Please configure DOMAIN_PACKS.',
                };
            },
        };
    }

    if (_registeredOrchestrator) return _registeredOrchestrator;

    log.warn('No orchestrator registered, returning empty fallback');
    return {
        async generateProposal() {
            return {
                proposedNodes: [],
                proposedEdges: [],
                estimatedCost: { currency: 'USD', total: 0 },
                approvalRequired: false,
                assistantMessage: 'No orchestrator configured.',
            };
        },
    };
};
