import { env } from '../../config/env';
import { log } from '../../utils/logger';

import type { Orchestrator } from './types';

export type { Orchestrator, ProposalResult } from './types';

/**
 * Orchestrator selection via ORCHESTRATOR_MODE env variable.
 *
 * - 'mock': Fixed 8-block proposal, no API calls
 * - 'openai': Real OpenAI API call with zod validation
 * - 'claude': Legacy Claude API call with zod validation
 *
 * Both implement the same Orchestrator interface.
 * Switch at runtime via env without code changes.
 */
export const getOrchestrator = async (): Promise<Orchestrator> => {
    const mode = env.orchestratorMode;

    if (mode === 'openai') {
        log.info('Using OpenAI orchestrator');
        const { openaiOrchestrator } = await import('./openai-orchestrator');
        return openaiOrchestrator;
    }

    if (mode === 'claude') {
        log.info('Using Claude orchestrator');
        const { claudeOrchestrator } = await import('./claude-orchestrator');
        return claudeOrchestrator;
    }

    log.info('Using mock orchestrator');
    const { mockOrchestrator } = await import('./mock-orchestrator');
    return mockOrchestrator;
};

// Re-export mock for direct use in tests
export { mockOrchestrator } from './mock-orchestrator';
