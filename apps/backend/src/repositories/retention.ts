import { env } from '../config/env';

const SECONDS_PER_DAY = 24 * 60 * 60;

const parseBaseTime = (isoDate?: string): number => {
    if (!isoDate) return Date.now();
    const parsed = Date.parse(isoDate);
    return Number.isFinite(parsed) ? parsed : Date.now();
};

export const retentionTtlFrom = (isoDate?: string): number =>
    Math.floor(parseBaseTime(isoDate) / 1000) + env.dataRetentionDays * SECONDS_PER_DAY;

export const withRetentionTtl = <T extends Record<string, unknown>>(
    item: T,
    isoDate?: string
): T & { ttl: number } => ({
    ...item,
    ttl: retentionTtlFrom(isoDate),
});

export const stripRetentionTtl = <T extends Record<string, unknown>>(item: T): T => {
    const { ttl: _ttl, ...rest } = item;
    return rest as T;
};
