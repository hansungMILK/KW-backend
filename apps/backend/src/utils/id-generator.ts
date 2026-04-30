import { ulid } from 'ulid';

/** Generate a ULID — time-sortable, unique. */
export const generateId = (): string => ulid();

/**
 * Backward-compatible function name for older call sites.
 * Values are ULIDs so independent Lambda processes cannot collide.
 */
export const generateNumericId = (): string => generateId();
