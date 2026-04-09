/**
 * Core orchestrator prompt templates — DOMAIN AGNOSTIC.
 *
 * This file provides generic planner prompt utilities.
 * Domain-specific prompts live in their respective domain packs.
 *
 * For shorts: modules/domain-packs/shorts-pack/prompts/orchestrator-prompt.ts
 */

export const CORE_PROMPT_VERSION = 'core-v1.0.0';

/**
 * Generic planner system prompt (used when no domain pack provides one).
 * This will be the base for Planner v2 in P5D.
 */
export const GENERIC_PLANNER_SYSTEM_PROMPT = `You are a workflow planner for an AI automation platform.
Design a workflow using the available blocks provided in the user message.
Return JSON: { "blocks": [...], "edges": [...], "estimatedCostUsd": number, "summary": "..." }`;

export const buildGenericUserPrompt = (userMessage: string, availableBlocks?: string[]): string => {
    let prompt = `User request: "${userMessage}"`;
    if (availableBlocks?.length) {
        prompt += `\n\nAvailable blocks: ${availableBlocks.join(', ')}`;
    }
    prompt += '\n\nDesign a workflow as JSON.';
    return prompt;
};
