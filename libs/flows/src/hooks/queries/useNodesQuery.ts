import { useMutation } from '@tanstack/react-query';

import { upsertEdge, upsertFlow } from '../../api';

import type { NodeView, SaveFlowView, UpsertNodeResult } from '../../types';
import type { EdgeData } from '@lemoncloud/eureka-flows-api';
import type { UseMutationResult } from '@tanstack/react-query';

interface UpsertNodeVariables {
    id: string;
    flowId: string;
    body: Partial<NodeView>;
}

/**
 * Mutation hook for upserting a node (create or update)
 * POST /flows/:flowId/upsert with { nodes: [{ id, ...body }], edges: [] }
 *
 * Migrated from POST /nodes/:id/upsert to flow-level upsert (P2).
 * This keeps the same call interface so useNodeSync does not need to change.
 */
export const useUpsertNodeMutation = (): UseMutationResult<SaveFlowView, Error, UpsertNodeVariables> => {
    return useMutation({
        mutationFn: ({ id, flowId, body }: UpsertNodeVariables) =>
            upsertFlow(flowId, { nodes: [{ id, ...body }], edges: [] }),
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
 * Mutation hook for creating a new node with server-assigned ID
 * POST /flows/:flowId/upsert with { nodes: [body], edges: [] }
 *
 * Migrated from POST /nodes/0/upsert to flow-level upsert (P2).
 * Server assigns the node ID and returns it in response.nodes[0].id.
 */
export const useCreateNodeMutation = (): UseMutationResult<SaveFlowView, Error, CreateNodeVariables> => {
    return useMutation({
        mutationFn: ({ flowId, body }: CreateNodeVariables) =>
            upsertFlow(flowId, { nodes: [body], edges: [] }),
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
 */
export const useCreateEdgeMutation = (): UseMutationResult<UpsertNodeResult, Error, CreateEdgeVariables> => {
    return useMutation({
        mutationFn: ({ flowId, edge }: CreateEdgeVariables) => upsertEdge(flowId, edge),
        onError: (error: Error) => {
            console.error('[useCreateEdgeMutation] Failed to create edge:', error);
        },
    });
};
