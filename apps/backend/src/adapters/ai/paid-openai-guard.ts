import { env } from '../../config/env';

export const PAID_OPENAI_DISABLED = 'PAID_OPENAI_DISABLED';

export class PaidOpenAIDisabledError extends Error {
    readonly code = PAID_OPENAI_DISABLED;

    constructor(operation: string) {
        super(
            `Paid OpenAI call blocked for ${operation}. Set ALLOW_PAID_OPENAI=1 only when you intentionally want to spend API credits.`
        );
        this.name = 'PaidOpenAIDisabledError';
    }
}

export const ensurePaidOpenAIAllowed = (operation: string): void => {
    if (!env.allowPaidOpenAI) {
        throw new PaidOpenAIDisabledError(operation);
    }
};

export const isPaidOpenAIAllowed = (): boolean => env.allowPaidOpenAI;
