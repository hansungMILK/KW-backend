#!/usr/bin/env node

const stage = process.argv[2] || process.env.STAGE || 'dev';

const requiredByStage = {
    dev: ['DEV_WEB_ORIGIN'],
    prod: ['PROD_WEB_ORIGIN'],
};

const missing = (requiredByStage[stage] || []).filter(name => !String(process.env[name] || '').trim());

if (missing.length > 0) {
    console.error(`[deploy-env] Missing required ${stage} deployment env: ${missing.join(', ')}`);
    process.exit(1);
}
