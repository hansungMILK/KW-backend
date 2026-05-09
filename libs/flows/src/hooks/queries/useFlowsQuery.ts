import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { flowsKeys } from './keys';
import { createFlow, getFlow, saveFlow, updateFlowMetadata } from '../../api';

import type {
    FlowView,
    LoadFlowPortData,
    LoadFlowResult,
    SaveFlowBody,
    SaveFlowView,
    UpdateFlowBody,
} from '../../types';

// Flow queries use the P3 spec API surface:
// POST /flows, GET /flows/{flowId}, PUT /flows/{flowId}.

/**
 * Query hook for loading flow (full design with nodes and edges)
 * GET /flows/{flowId}
 */
export const useLoadFlowQuery = (flowId: string | null) => {
    return useQuery({
        queryKey: flowsKeys.snapshot(flowId ?? ''),
        queryFn: () => {
            if (!flowId) throw new Error('flowId is required');
            return getFlow(flowId);
        },
        enabled: !!flowId,
    });
};

/**
 * Mutation hook for creating a new flow via POST /flows
 * Returns SaveFlowView which includes the server-generated flow ID
 */
export const useCreateFlowMutation = () => {
    return useMutation({
        mutationFn: (body?: Partial<SaveFlowBody>) => createFlow(body),
    });
};

/**
 * Mutation hook for saving flow (full workflow state)
 * PUT /flows/{flowId}
 *
 * Uses optimistic updates for seamless UX:
 * - Immediately updates cache on mutate
 * - Rolls back on error
 * - No invalidateQueries to avoid unnecessary refetch
 */
export const useSaveFlowMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, body }: { id: string; body: SaveFlowBody }) => saveFlow(id, body),
        onMutate: async ({ id, body }) => {
            // Cancel any outgoing refetches to prevent overwriting optimistic update
            await queryClient.cancelQueries({ queryKey: flowsKeys.snapshot(id) });

            // Snapshot the previous value for rollback
            const previousData = queryClient.getQueryData<LoadFlowResult>(flowsKeys.snapshot(id));

            // Optimistically update the cache
            if (previousData) {
                queryClient.setQueryData<LoadFlowResult>(flowsKeys.snapshot(id), old => ({
                    ...(old ?? previousData),
                    nodes: body.nodes,
                    edges: body.edges,
                }));
            }

            // Return context for rollback
            return { previousData };
        },
        onError: (_error, { id }, context) => {
            // Rollback to previous data on error
            if (context?.previousData) {
                queryClient.setQueryData(flowsKeys.snapshot(id), context.previousData);
            }
        },
        // No onSuccess/onSettled invalidateQueries - optimistic update is sufficient
        // This prevents unnecessary refetch after save
        retry: 2,
        retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 10000),
    });
};

/**
 * Mutation hook for updating flow metadata (name, etc.)
 * POST /flows/:id
 *
 * @see eureka-flows-api v0.26.126
 */
export const useUpdateFlowMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, body }: { id: string; body: UpdateFlowBody }) => updateFlowMetadata(id, body),
        onSuccess: (data, { id }) => {
            // Update the flow snapshot cache with new metadata
            queryClient.setQueryData<LoadFlowResult>(flowsKeys.snapshot(id), old => {
                if (!old) return old;
                return {
                    ...old,
                    name: data.name ?? old.name,
                };
            });
        },
    });
};

// Re-export types for convenience
export type { FlowView, LoadFlowPortData, LoadFlowResult, SaveFlowBody, SaveFlowView, UpdateFlowBody };
