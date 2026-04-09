import { env } from '../../config/env';
import { plainText } from '../../utils/response';

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * GET / — system info (plain text, matches existing frontend contract)
 * Caller: libs/flows/src/api/system.ts → getSystemInfo()
 *
 * Frontend parses: "name/version" per line
 */
export const main = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const version = '0.1.0';
    return plainText(`eureka-flows-backend/${version}\nstage/${env.stage}`);
};
