import { useCallback, useEffect } from 'react';

import { useWebCoreStore } from '@flows/web-core';

import { useWebSocketWorker } from './useWebSocketWorker';
import { useWebSocketStore } from '../stores/useWebSocketStore';

import type {
    AssetCreatedMessage,
    FlowUpdateMessage,
    NodeEventMessage,
    NodeState,
    NodeUpdateMessage,
    PortUpdateMessage,
    ProposalCreatedMessage,
    RunCompletedMessage,
    RunEventMessage,
    RunFailedMessage,
    RunStartedMessage,
    WebSocketMessage,
} from '../types';

const WS_ENDPOINT = import.meta.env.VITE_WS_ENDPOINT || '';

/**
 * Parse raw WebSocket message data into WebSocketMessage
 * Only extracts the ID for routing - feature-specific parsing happens in subscribers
 */
const parseWebSocketMessage = (data: unknown): WebSocketMessage | null => {
    if (typeof data !== 'object' || data === null) {
        return null;
    }
    const msg = data as Record<string, unknown>;

    // Handle wrapped message format: { action: 'message', data: {...} }
    const payload =
        'action' in msg && msg['action'] === 'message' && 'data' in msg && msg['data']
            ? (msg['data'] as Record<string, unknown>)
            : msg;

    // Check for various ID fields across event types
    const messageId =
        (payload['id'] as string) ||
        (payload['nodeId'] as string) ||
        (payload['runId'] as string) ||
        (payload['assetId'] as string) ||
        (payload['proposalId'] as string);

    if (messageId) {
        return {
            id: messageId,
            data: payload,
        };
    }

    return null;
};

/**
 * Type guard for FlowUpdateMessage (new format)
 */
export const isFlowUpdateMessage = (data: unknown): data is FlowUpdateMessage => {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    return msg['type'] === 'flow' && typeof msg['id'] === 'string' && !('nodeId' in msg);
};

export const isNodeUpdateMessage = (data: unknown): data is NodeUpdateMessage => {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    return msg['type'] === 'node' && typeof msg['id'] === 'string' && !('nodeId' in msg);
};

/**
 * Type guard for PortUpdateMessage
 * Matches: { type: 'node/port', id: 'nodeId:direction@portName', ... }
 */
export const isPortUpdateMessage = (data: unknown): data is PortUpdateMessage => {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    return msg['type'] === 'node/port' && typeof msg['id'] === 'string';
};

export const isProposalCreatedMessage = (data: unknown): data is ProposalCreatedMessage => {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    return msg['type'] === 'proposal.created' && typeof msg['proposalId'] === 'string';
};

export const isRunEventMessage = (data: unknown): data is RunEventMessage => {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    const type = msg['type'];
    return (
        (type === 'run.started' || type === 'run.completed' || type === 'run.failed') &&
        typeof msg['runId'] === 'string'
    );
};

// Spec-named aliases (명세서 기준 타입가드 이름)
export const isRunStartedMessage = (data: unknown): data is RunStartedMessage => {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    return msg['type'] === 'run.started' && typeof msg['runId'] === 'string';
};
export const isRunCompletedMessage = (data: unknown): data is RunCompletedMessage => {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    return msg['type'] === 'run.completed' && typeof msg['runId'] === 'string';
};
export const isRunFailedMessage = (data: unknown): data is RunFailedMessage => {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    return msg['type'] === 'run.failed' && typeof msg['runId'] === 'string';
};

export const isNodeEventMessage = (data: unknown): data is NodeEventMessage => {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    const type = msg['type'];
    return (
        (type === 'node.started' || type === 'node.progress' || type === 'node.completed' || type === 'node.failed') &&
        typeof msg['nodeId'] === 'string'
    );
};
// Spec-named alias (명세서 기준: isNodeExecutionMessage)
export const isNodeExecutionMessage = isNodeEventMessage;

export const isAssetCreatedMessage = (data: unknown): data is AssetCreatedMessage => {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    return msg['type'] === 'asset.created' && typeof msg['assetId'] === 'string';
};

/**
 * Parse port ID into components
 * Format: "nodeId:portName@direction" (e.g., "1000637:in@in")
 *
 * - Full ID with @: "1000637:in@in" → nodeId=1000637, portName=in, direction=in
 * - ID without @: "1000637:in" → nodeId=1000637, portName=in, direction from API
 */
const parsePortId = (
    fullId: string
): { nodeId: string; portId: string; portName: string; direction?: 'in' | 'out' } | null => {
    // Check for @ which indicates direction suffix
    const atIndex = fullId.indexOf('@');

    let portId: string;
    let direction: 'in' | 'out' | undefined;

    if (atIndex !== -1) {
        // Format: "nodeId:portName@direction"
        portId = fullId.slice(0, atIndex); // "1000637:in"
        const directionStr = fullId.slice(atIndex + 1); // "in" or "out"
        if (directionStr === 'in' || directionStr === 'out') {
            direction = directionStr;
        }
    } else {
        // Format: "nodeId:portName" (no direction suffix)
        portId = fullId;
    }

    // Parse portId to get nodeId and portName
    const colonIndex = portId.indexOf(':');
    if (colonIndex === -1) return null;

    const nodeId = portId.slice(0, colonIndex); // "1000637"
    const portName = portId.slice(colonIndex + 1); // "in"

    return { nodeId, portId, portName, direction };
};

export interface NodeUpdateInfo {
    nodeId: string;
    flowId?: string;
    timestamp?: number;
    /**
     * Message sequence number (monotonically increasing)
     * Higher values indicate more recent updates - used for ordering
     */
    no?: number;
    /**
     * @deprecated Use `state` instead. Kept for backward compatibility.
     */
    status?: string;
    /**
     * @deprecated Use `prevState` instead. Kept for backward compatibility.
     */
    prevStatus?: string;
    isPort: boolean;
    parentNodeId?: string;
    /**
     * Node execution state (preferred field)
     * Values: 'IDLE' | 'READY' | 'RUNNING' | 'COMPLETED' | 'ERROR'
     */
    state?: NodeState;
    /**
     * Previous execution state before this update
     */
    prevState?: NodeState;
    progress?: number;
    /**
     * Stereotype indicator for message content completeness
     * - 0: Socket message contains all necessary data - no API fetch needed
     * - Other values or undefined: Additional data may be needed via API
     */
    stereo?: number;
}

/**
 * Port update info parsed from WebSocket message
 * Used by onPortUpdate callback for port data synchronization
 */
export interface PortUpdateInfo {
    /** Port ID for API call: "nodeId:portName" (e.g., "1000637:in") */
    portId: string;
    /** Parent node ID (e.g., "1000637") */
    nodeId: string;
    /** Port name/key (e.g., "in", "out", "data") */
    portName: string;
    /** Port direction (from @suffix: "in" or "out") */
    direction?: 'in' | 'out';
    /** Flow ID */
    flowId?: string;
    /** Timestamp when port data changed */
    timestamp?: number;
    /**
     * Message sequence number (monotonically increasing)
     * Higher values indicate more recent updates - used for ordering
     */
    no?: number;
}

export interface UseInitFlowSocketOptions {
    /** Channel ID to subscribe to (from flow load response) */
    channelId?: string | null;
    /** Current flow ID for filtering messages */
    currentFlowId?: string | null;
    /** Getter for last local update timestamp - messages within 3s of this are ignored (prevents self-echo) */
    getLastLocalUpdateTimestamp?: () => number | null;
    /** Callback when flow update notification is received - should reload entire flow */
    onFlowUpdate?: (flowId: string) => void;
    /** Callback when node update notification is received - should reload single node */
    onNodeReload?: (info: NodeUpdateInfo) => void;
    /** Callback when port update notification is received - should fetch port data */
    onPortUpdate?: (info: PortUpdateInfo) => void;
    /** Callback when agent creates a proposal in response to a user message */
    onProposalCreated?: (proposalId: string, flowId?: string) => void;
    /** Callback when a run lifecycle event is received (started/completed/failed) */
    onRunUpdate?: (type: RunEventMessage['type'], runId: string, flowId?: string, error?: string) => void;
    /** Callback when a node event is received from an orchestrator run */
    onNodeEvent?: (type: NodeEventMessage['type'], nodeId: string, progress?: number, flowId?: string) => void;
    /** Callback when a run produces an output asset */
    onAssetCreated?: (assetId: string, assetType?: string, url?: string, flowId?: string) => void;
}

/**
 * Flow-specific WebSocket initialization hook
 * - Connects to WebSocket with flow channel ID
 * - Broadcasts all messages to subscribers via store
 * - Handles new message format: { type: 'flow'|'node', id, flowId?, timestamp }
 * - Provides callbacks for flow and node update notifications
 *
 * @param options - Configuration options
 * @returns WebSocket control functions
 *
 * @example
 * const { connect, disconnect, isConnected } = useInitFlowSocket({
 *   channelId: '1000011',
 *   currentFlowId: '1000011',
 *   onFlowUpdate: (flowId) => {
 *     // Reload entire flow: GET /flows/:id/load
 *   },
 *   onNodeReload: (info) => {
 *     // Reload node: GET /nodes/:id
 *     // info contains: nodeId, flowId, timestamp, status, prevStatus
 *   },
 * });
 */
export const useInitFlowSocket = (options: UseInitFlowSocketOptions = {}) => {
    const {
        channelId,
        currentFlowId,
        getLastLocalUpdateTimestamp,
        onFlowUpdate,
        onNodeReload,
        onPortUpdate,
        onProposalCreated,
        onRunUpdate,
        onNodeEvent,
        onAssetCreated,
    } = options;

    const apiKey = useWebCoreStore(state => state.apiKey);
    const setId = useWebSocketStore(state => state.setId);
    const setConnectionStatus = useWebSocketStore(state => state.setConnectionStatus);
    const broadcastMessage = useWebSocketStore(state => state.broadcastMessage);
    const reset = useWebSocketStore(state => state.reset);

    const tokenProvider = useCallback(async (): Promise<string | null> => {
        return apiKey || null;
    }, [apiKey]);

    const {
        id,
        connectionStatus,
        lastMessage,
        disconnect,
        connect,
        reconnect,
        send,
        isConnected,
        reconnectAttempts,
        maxReconnectReached,
    } = useWebSocketWorker<WebSocketMessage>({
        endpoint: WS_ENDPOINT,
        tokenProvider,
        messageParser: parseWebSocketMessage,
        enabled: !!apiKey,
        logPrefix: '[FlowSocket]',
        channels: channelId || undefined,
    });

    // Sync WebSocket state to store
    useEffect(() => {
        setId(id);
    }, [id, setId]);

    useEffect(() => {
        setConnectionStatus(connectionStatus);
    }, [connectionStatus, setConnectionStatus]);

    // Broadcast messages to all subscribers and handle updates
    useEffect(() => {
        if (lastMessage) {
            broadcastMessage(lastMessage);

            const data = lastMessage.data;

            // Self-echo prevention: ignore messages within 3 seconds of our last local change
            const DEBOUNCE_MS = 3000;
            const now = Date.now();
            const lastUpdate = getLastLocalUpdateTimestamp?.();
            const isRecentLocalUpdate = lastUpdate && now - lastUpdate < DEBOUNCE_MS;

            // Handle new format: flow update notification
            if (isFlowUpdateMessage(data)) {
                // Skip if we just made local changes (self-echo prevention)
                if (isRecentLocalUpdate) {
                    return;
                }
                // Only process if it's for the current flow
                if (currentFlowId && data.id === currentFlowId && onFlowUpdate) {
                    onFlowUpdate(data.id);
                }
                return;
            }

            // Handle node update notification (includes status changes and progress)
            // Socket message is just a notification - actual data is fetched via API
            // NOTE: Node updates do NOT use self-echo prevention because:
            // - Node run results come via socket and must be processed
            // - Self-echo prevention is only for flow save operations
            if (isNodeUpdateMessage(data)) {
                // Skip history nodes (format: nodeId@N like 'ywb8c99z3@2')
                // History nodes are snapshots and don't need to trigger updates
                const isHistoryNode = data.id.includes('@');
                if (isHistoryNode) return;

                // Check if this is a port update (id contains ':' like 'nodeId:5')
                const isPort = data.id.includes(':');
                const parentNodeId = isPort ? data.id.split(':')[0] : undefined;

                // Skip if flowId is missing or doesn't match current flow
                // All node updates should have flowId - reject those without it
                const isForCurrentFlow = data.flowId && data.flowId === currentFlowId;
                if (!isForCurrentFlow) {
                    return;
                }

                // Log state transitions with data (e.g., "1004310: IDLE→RUNNING {...}")
                const stateChange = data.prevState ? `${data.prevState}→${data.state}` : data.state;
                console.log(`[WS] ${data.id}: ${stateChange}`, data);

                if (onNodeReload) {
                    // Prefer state over status (backward compatibility)
                    const effectiveState = (data.state ?? data.status) as NodeState | undefined;
                    const effectivePrevState = (data.prevState ?? data.prevStatus) as NodeState | undefined;

                    onNodeReload({
                        nodeId: data.id,
                        flowId: data.flowId,
                        timestamp: data.timestamp,
                        no: data.no,
                        // Deprecated fields (kept for backward compatibility)
                        status: data.status,
                        prevStatus: data.prevStatus,
                        isPort,
                        parentNodeId,
                        // Preferred fields
                        state: effectiveState,
                        prevState: effectivePrevState,
                        progress: data.progress,
                        stereo: data.stereo,
                    });
                }
                return;
            }

            // Handle orchestrator events (proposal.created, run.*, node.*, asset.created)
            if (isProposalCreatedMessage(data)) {
                if (data.flowId === currentFlowId) {
                    onProposalCreated?.(data.proposalId, data.flowId);
                }
                return;
            }

            if (isRunEventMessage(data)) {
                if (!data.flowId || data.flowId === currentFlowId) {
                    const error = data.type === 'run.failed' ? data.errorMessage : undefined;
                    onRunUpdate?.(data.type, data.runId, data.flowId, error);
                }
                return;
            }

            if (isNodeEventMessage(data)) {
                if (!data.flowId || data.flowId === currentFlowId) {
                    onNodeEvent?.(data.type, data.nodeId, data.progress, data.flowId);
                }
                return;
            }

            if (isAssetCreatedMessage(data)) {
                if (!data.flowId || data.flowId === currentFlowId) {
                    onAssetCreated?.(data.assetId, data.assetType, data.url ?? data.publicUrl, data.flowId);
                }
                return;
            }

            // Handle port update notification (type: 'node/port')
            // Triggered when port data (input/output) changes
            // Used for real-time data synchronization between browser tabs
            if (isPortUpdateMessage(data)) {
                // Skip if flowId is missing or doesn't match current flow
                const isForCurrentFlow = data.flowId && data.flowId === currentFlowId;
                if (!isForCurrentFlow) {
                    return;
                }

                // Parse port ID to extract nodeId, direction, portName
                const parsed = parsePortId(data.id);
                if (!parsed) return;

                // Log port updates with data (e.g., "1004310:out updated {...}")
                console.log(`[WS] ${parsed.nodeId}:${parsed.portName} updated`, data);

                if (onPortUpdate) {
                    onPortUpdate({
                        portId: parsed.portId, // "nodeId:portName" without @direction
                        nodeId: parsed.nodeId,
                        portName: parsed.portName,
                        direction: parsed.direction, // from @suffix
                        flowId: data.flowId,
                        timestamp: data.timestamp,
                        no: data.no,
                    });
                }
            }
        }
    }, [
        lastMessage,
        broadcastMessage,
        currentFlowId,
        getLastLocalUpdateTimestamp,
        onFlowUpdate,
        onNodeReload,
        onPortUpdate,
        onProposalCreated,
        onRunUpdate,
        onNodeEvent,
        onAssetCreated,
    ]);

    // Cleanup on unmount
    // Note: Empty deps intentional - runs only on unmount
    useEffect(() => {
        return () => {
            disconnect();
            reset();
        };
    }, []);

    // Reconnect when channelId changes
    // Note: connect/disconnect intentionally excluded to prevent infinite loops
    useEffect(() => {
        if (apiKey) {
            void connect();
        } else {
            disconnect();
        }
    }, [channelId, apiKey]);

    return {
        connect,
        disconnect,
        reconnect,
        send,
        isConnected,
        connectionStatus,
        reconnectAttempts,
        maxReconnectReached,
    };
};
