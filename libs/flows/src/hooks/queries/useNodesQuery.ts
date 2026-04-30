import { useMutation } from '@tanstack/react-query';

import { upsertEdge, upsertFlow } from '../../api';

import type { EdgeData, NodeData, NodeView } from '../../types';
import type { UseMutationResult } from '@tanstack/react-query';

interface UpsertNodeVariables {
    id: string;
    flowId: string;
    body: Partial<NodeView>;
}

/**
 * Mutation hook for upserting a node via Flow PUT
 * POST /flows/:id/upsert (transitioning to PUT /flows/{flowId} in P3)
 *
 * @deprecated individual /nodes/:id/upsert path removed — now routes through upsertFlow
 */
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

/**
 * Mutation hook for creating a new node via Flow upsert
 * POST /flows/:id/upsert (transitioning to PUT /flows/{flowId} in P3)
 *
 * Server assigns the node ID and returns it in response.nodes[0].
 *
 * @deprecated individual /nodes/0/upsert path removed — now routes through upsertFlow
 */
export const useCreateNodeMutation = () => {
    return useMutation({
        mutationFn: ({ flowId, body }: CreateNodeVariables) =>
            upsertFlow(flowId, { nodes: [body as NodeData], edges: [] }),
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
 * Edge creation should use POST /flows/:id/upsert with { nodes: [], edges: [...] }
 *
 * This hook incorrectly uses upsertEdge() which calls the wrong API endpoint.
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
