import { useMutation } from '@tanstack/react-query';

import { updateFlow, upsertEdge } from '../../api';

import type { NodeView } from '../../types';
import type { EdgeData, NodeData } from '@lemoncloud/eureka-flows-api';
import type { UseMutationResult } from '@tanstack/react-query';

interface UpsertNodeVariables {
    id: string;
    flowId: string;
    body: Partial<NodeView>;
}

/** Mutation hook for upserting a node via PUT /flows/{flowId} */
export const useUpsertNodeMutation = () => {
    return useMutation({
        mutationFn: ({ id, flowId, body }: UpsertNodeVariables) =>
            updateFlow(flowId, { nodes: [{ id, ...(body as NodeData) }], edges: [] }),
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
        mutationFn: ({ flowId, body }: CreateNodeVariables) =>
            updateFlow(flowId, { nodes: [body as NodeData], edges: [] }),
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
