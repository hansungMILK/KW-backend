import { useMutation } from '@tanstack/react-query';

import { upsertEdge, upsertFlow } from '../../api';

import type { EdgeData, NodeData, NodeView } from '../../types';
import type { UseMutationResult } from '@tanstack/react-query';

const createClientNodeId = (): string => `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

interface UpsertNodeVariables {
    id: string;
    flowId: string;
    body: Partial<NodeView>;
}

/** Mutation hook for upserting a node via PUT /flows/{flowId} */
export const useUpsertNodeMutation = () => {
    return useMutation({
        mutationFn: ({ id, flowId, body }: UpsertNodeVariables) =>
            upsertFlow(flowId, { nodes: [{ ...(body as Partial<NodeData>), id } as NodeData], edges: [] }),
        onError: (error: Error, { id }) => {
            console.error(`[useUpsertNodeMutation] Failed to upsert node ${id}:`, error);
        },
    });
};

interface CreateNodeVariables {
    flowId: string;
    body: Partial<NodeView>;
}

/** Mutation hook for creating a new node via PUT /flows/{flowId} */
export const useCreateNodeMutation = () => {
    return useMutation({
        mutationFn: async ({ flowId, body }: CreateNodeVariables) => {
            const node = { id: createClientNodeId(), ...(body as Partial<NodeData>) } as NodeData;
            const result = await upsertFlow(flowId, { nodes: [node], edges: [] });
            return {
                ...result,
                nodes: [node, ...(result.nodes ?? []).filter(item => item.id !== node.id)],
            };
        },
        onError: (error: Error) => {
            console.error('[useCreateNodeMutation] Failed to create node:', error);
        },
    });
};

interface CreateEdgeVariables {
    flowId: string;
    edge: EdgeData;
}

/**
 * @deprecated Use useEdgeSync hook instead for edge creation
 */
export const useCreateEdgeMutation = (): UseMutationResult<
    Awaited<ReturnType<typeof upsertEdge>>,
    Error,
    CreateEdgeVariables
> => {
    return useMutation({
        mutationFn: ({ flowId, edge }: CreateEdgeVariables) => upsertEdge(flowId, edge),
        onError: (error: Error) => {
            console.error('[useCreateEdgeMutation] Failed to create edge:', error);
        },
    });
};
