import { DeleteCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { TableNames, USE_REAL_DYNAMO, getDocClient, memDb } from '../adapters/aws/dynamodb';

const TABLE = USE_REAL_DYNAMO ? TableNames.connections : 'connections';

export interface Connection {
    connectionId: string;
    flowId: string;
    channels: string[];
    connectedAt: string;
    ttl: number;
}

export const connectionRepo = {
    async put(conn: Connection): Promise<void> {
        if (USE_REAL_DYNAMO) {
            await getDocClient().send(new PutCommand({ TableName: TABLE, Item: conn }));
            return;
        }
        memDb.put(TABLE, conn.connectionId, conn as unknown as Record<string, unknown>);
    },

    async delete(connectionId: string): Promise<void> {
        if (USE_REAL_DYNAMO) {
            await getDocClient().send(new DeleteCommand({ TableName: TABLE, Key: { connectionId } }));
            return;
        }
        memDb.delete(TABLE, connectionId);
    },

    async listByChannel(channel: string): Promise<Connection[]> {
        if (USE_REAL_DYNAMO) {
            const result = await getDocClient().send(
                new ScanCommand({
                    TableName: TABLE,
                    FilterExpression: 'contains(channels, :channel)',
                    ExpressionAttributeValues: { ':channel': channel },
                })
            );
            return (result.Items || []) as Connection[];
        }
        return memDb.query(TABLE, item => {
            const channels = (item as { channels?: string[] }).channels;
            return Array.isArray(channels) && channels.includes(channel);
        }) as unknown as Connection[];
    },

    async listAll(): Promise<Connection[]> {
        if (USE_REAL_DYNAMO) {
            const result = await getDocClient().send(new ScanCommand({ TableName: TABLE }));
            return (result.Items || []) as Connection[];
        }
        return memDb.scan(TABLE) as unknown as Connection[];
    },
};
