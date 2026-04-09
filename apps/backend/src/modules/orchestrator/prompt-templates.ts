/**
 * Prompt templates for the orchestrator.
 * Versioned for trace/audit purposes.
 *
 * Shorts-specific prompts have been moved to:
 *   modules/domain-packs/shorts-pack/prompts/orchestrator-prompt.ts
 *
 * This file re-exports them under the original names for backward compatibility.
 */

export {
    SHORTS_PROMPT_VERSION as PROMPT_VERSION,
    SHORTS_ORCHESTRATOR_SYSTEM_PROMPT as ORCHESTRATOR_SYSTEM_PROMPT,
    buildShortsUserPrompt as buildUserPrompt,
} from '../domain-packs/shorts-pack/prompts/orchestrator-prompt';
