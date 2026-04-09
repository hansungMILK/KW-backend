import { env } from '../config/env';

export const log = {
    info: (msg: string, data?: unknown) => {
        console.log(JSON.stringify({ level: 'INFO', stage: env.stage, msg, ...(data ? { data } : {}) }));
    },
    warn: (msg: string, data?: unknown) => {
        console.warn(JSON.stringify({ level: 'WARN', stage: env.stage, msg, ...(data ? { data } : {}) }));
    },
    error: (msg: string, error?: unknown) => {
        const errData =
            error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
        console.error(JSON.stringify({ level: 'ERROR', stage: env.stage, msg, error: errData }));
    },
};
