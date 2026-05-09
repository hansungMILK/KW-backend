import type {
    BlockDefinition as ApiBlockDefinition,
    ConfigField as ApiConfigField,
    DataPacket as ApiDataPacket,
    DataType as ApiDataType,
    EdgeData as ApiEdgeData,
    NodeData as ApiNodeData,
    PortDefinition as ApiPortDefinition,
    BlockView,
    ConfigFieldModel,
    ConfigFieldWithDefault,
    ConfigOption,
    ExecutionStats,
    ListResult,
    LogEntry,
    NodeConfigItem,
    NodeDataPacketItem,
    NodeStatus,
    ProcessBody,
    ProcessResult,
} from '@lemoncloud/eureka-flows-api';

export type {
    BlockView,
    ConfigFieldModel,
    ConfigFieldWithDefault,
    ConfigOption,
    ExecutionStats,
    ListResult,
    LogEntry,
    NodeConfigItem,
    NodeDataPacketItem,
    NodeStatus,
    ProcessBody,
    ProcessResult,
};

export type DataType = ApiDataType | 'markdown' | 'audio' | 'video' | 'file' | (string & {});

export interface DataPacket extends Omit<ApiDataPacket, 'type'> {
    type: DataType;
}

export interface PortDefinition extends Omit<ApiPortDefinition, 'type'> {
    type: DataType;
}

export interface ConfigField extends ApiConfigField {
    description?: string;
    defaultValue?: string | number | boolean | null;
}

export interface BlockDefinition
    extends Omit<ApiBlockDefinition, 'inputs' | 'outputs' | 'configSchema' | 'defaultConfig' | 'execute'> {
    inputs: PortDefinition[];
    outputs: PortDefinition[];
    defaultConfig: Record<string, unknown>;
    configSchema?: ConfigField[];
    configFields?: ConfigField[];
    input$?: PortDefinition[];
    output$?: PortDefinition[];
    execute?: (
        inputs: Record<string, DataPacket>,
        config: Record<string, unknown>,
        onProgress?: (progress: number) => void
    ) => Promise<Record<string, DataPacket>>;
}

// ============================================================================
// Node Execution State (state field - replacing status)
// ============================================================================

/**
 * NodeState - execution state of a node
 *
 * Values:
 * - IDLE: Initial state, no execution started
 * - READY: All inputs ready, waiting for execution
 * - RUNNING: Currently executing
 * - COMPLETED: Execution finished successfully
 * - ERROR: Execution failed
 *
 * @note This replaces the deprecated `status` field.
 * During migration, use `node.state ?? node.status` for backward compatibility.
 */
export type NodeState = 'IDLE' | 'READY' | 'RUNNING' | 'COMPLETED' | 'ERROR';

/**
 * Canvas node shape used by this app.
 *
 * The upstream API package exposes the persisted node shape, but our canvas also
 * carries runtime state (`state`, mutable packet maps, local config edits). Keep
 * this type explicit instead of leaking those app-only fields through casts.
 */
export interface NodeData
    extends Omit<
        ApiNodeData,
        'id' | 'config' | 'status' | 'inputData' | 'outputData' | 'autoExecutionEnabled' | 'executionStats'
    > {
    id: string;
    config?: Record<string, unknown>;
    name?: string;
    required?: boolean;
    enterNo?: number;
    exitNo?: number;
    state?: NodeState;
    status?: NodeState | string;
    inputData?: Record<string, DataPacket>;
    outputData?: Record<string, DataPacket>;
    autoExecutionEnabled?: boolean;
    executionStats?: ExecutionStats;
}

export interface EdgeData extends ApiEdgeData {}

/** UI name for graph edges. Kept for legacy canvas code while payload remains EdgeData-compatible. */
export interface Connection extends EdgeData {
    id?: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
    disabled?: boolean;
    position?: Position;
    label?: string;
}

export interface WorkflowState {
    nodes: NodeData[];
    edges?: EdgeData[];
    /** @deprecated The canonical graph field is `edges`; kept for legacy canvas history. */
    connections?: Connection[];
}

// ============================================================================
// Block Definition Extension (isFrontend support)
// ============================================================================

/**
 * BlockDefinitionWithFrontend - extends BlockDefinition with isFrontend flag
 *
 * This type extends the API package's BlockDefinition to include the `isFrontend`
 * flag from the server response. When the API package is updated, this can be removed.
 *
 * @see /blocks API response
 *
 * Execution logic:
 * - `isFrontend: true` → Execute on client (use `execute` function)
 * - `isFrontend: false` → Execute on server via flow run APIs
 * - `isFrontend: undefined` → Fallback to legacy BACKEND_PROCESSOR_TYPES check
 */
/**
 * BlockStereo - stereotype of block for categorization
 * Matches server's BlockStereo type
 */
export type BlockStereo = 'input' | 'process' | 'output';

export interface BlockDefinitionWithFrontend extends BlockDefinition {
    /**
     * Indicates whether this block should be executed on the frontend (client-side)
     * or requires backend processing (server-side).
     *
     * - `true`: Client-side execution using the `execute` function
     * - `false`: Server-side execution via flow run APIs
     * - `undefined`: Use legacy fallback (BACKEND_PROCESSOR_TYPES check)
     */
    isFrontend?: boolean;

    /**
     * Block stereotype for categorization (input, process, output)
     * Used by Sidebar for grouping blocks
     */
    stereo?: BlockStereo;

    /**
     * Indicates whether this block can be executed (shows run button)
     * - `true` or `undefined`: Run button is visible (default behavior)
     * - `false`: Run button is hidden
     */
    isRunnable?: boolean;

    /**
     * The function that runs when the block triggers (client-side only)
     * This is attached by the frontend when `isFrontend: true`
     */
    execute?: (
        inputs: Record<string, DataPacket>,
        config: Record<string, unknown>,
        onProgress?: (progress: number) => void
    ) => Promise<Record<string, DataPacket>>;
}

/**
 * FlowStereo - stereotype of flow model
 */
export type FlowStereo = '' | '#' | '#template';

/**
 * FlowState - lifecycle state of flow
 */
export type FlowState = 'draft' | 'active' | 'archived' | 'DRAFT' | 'READY' | 'ARCHIVED';

/**
 * FlowModel - flow model for CRUD operations
 *
 * NOTE: Execution state (running/completed/error) is managed at NODE level,
 * not flow level. Each node has its own `status` field.
 * Flow only stores lifecycle state (draft/active/archived).
 */
export interface FlowModel {
    id?: string;
    stereo?: FlowStereo;
    name?: string;
    state?: FlowState;
    description?: string;
    channelId?: string;
    seq?: number;
    meta?: unknown;
    createdAt?: string;
    updatedAt?: string;
}

/**
 * FlowView - view representation of flow model
 */
export interface FlowView extends Partial<FlowModel> {}

/**
 * FlowBody - body for flow creation/update
 */
export interface FlowBody extends Partial<FlowView> {}

/**
 * EdgeStereo - stereotype of edge (connection)
 */
export type EdgeStereo = '' | '#' | '#condition' | '#transform';

/**
 * Position - position on canvas
 */
export interface Position {
    x: number;
    y: number;
}

/**
 * EdgeModel - model for edge (connection) info
 */
export interface EdgeModel {
    id?: string;
    stereo?: EdgeStereo;
    label?: string;
    flowId?: string;
    sourceNodeId?: string;
    sourcePortId?: string;
    targetNodeId?: string;
    targetPortId?: string;
    condition?: string;
    priority?: number;
    position?: Position;
    disabled?: boolean;
    meta?: unknown;
    createdAt?: string;
    updatedAt?: string;
}

/**
 * EdgeView - view representation of edge model
 */
export interface EdgeView extends Partial<EdgeModel> {}

/**
 * EdgeBody - body for edge creation/update
 */
export interface EdgeBody extends Partial<EdgeView> {}

/**
 * NodeStereo - stereotype of node
 */
export type NodeStereo = '' | '#' | '#alias';

/**
 * ConfigItem - config key-value pair for DB serialization
 */
export interface ConfigItem {
    key: string;
    val: string;
}

/**
 * DataPacketItem - data packet with port id (OpenSearch compatible)
 */
export interface DataPacketItem {
    portId: string;
    packet: {
        value: unknown;
        type: string;
        timestamp?: number;
    };
}

/**
 * PortData - data stored in a port node
 * Server uses DynamoDB-style typed values
 */
export interface PortData {
    /** String value (for text, image types) */
    S?: string;
    /** Number value (integer) */
    N?: number;
    /** Float value */
    F?: number;
    /** Stringified JSON (for json, any types) */
    M?: string;
    /** Timestamp when data was produced */
    timestamp?: number;
}

/**
 * PortDataResponse - port data derived from GET /flows/{flowId}
 *
 * @example
 * {
 *   "id": "1000882:in@in",
 *   "nodeId": "1000882",
 *   "portId": "in",
 *   "direction": "in",
 *   "data": {
 *     "value": "Hello World",
 *     "type": "text",
 *     "timestamp": 1771898187560
 *   }
 * }
 */
export interface PortDataResponse {
    /** Full port ID (e.g., "1000882:in@in") */
    id: string;
    /** Parent node ID (e.g., "1000882") */
    nodeId: string;
    /** Port name/key (e.g., "in") */
    portId: string;
    /** Port direction */
    direction: 'in' | 'out';
    /** Port data in DataPacket-like format */
    data: {
        value: unknown;
        type: string;
        timestamp?: number;
    };
}

/**
 * NodeModel - extended node model for backend
 *
 * Execution state is managed at node level:
 * - state: IDLE → READY → RUNNING → COMPLETED/ERROR (new field)
 * - status: IDLE → RUNNING → COMPLETED/ERROR (deprecated, use state)
 * - autoExecutionEnabled: auto-trigger on inputData change
 */
export interface NodeModel {
    id?: string;
    stereo?: NodeStereo | 'port';
    name?: string;
    url?: string;
    image?: string;
    thumb?: string;
    tags?: string[];
    meta?: unknown;
    blockId?: string;
    block$?: BlockHead;
    input$$?: Array<{ id: string; label: string; type: string; required?: boolean }>;
    output$$?: Array<{ id: string; label: string; type: string; required?: boolean }>;
    position?: Position;
    width?: number;
    height?: number;
    config?: Record<string, unknown>;
    config$$?: ConfigItem[];
    customLabel?: string;
    description?: string;
    /**
     * Node execution state (new field - preferred)
     * Values: 'IDLE' | 'READY' | 'RUNNING' | 'COMPLETED' | 'ERROR'
     */
    state?: NodeState;
    /**
     * @deprecated Use `state` instead. Kept for backward compatibility.
     */
    status?: string;
    errorMessage?: string;
    inputData$$?: DataPacketItem[];
    outputData$$?: DataPacketItem[];
    executionStats?: {
        startTime?: number;
        duration?: number;
        progress?: number;
    };
    flowId?: string;
    runId?: string;
    lastGoodOutput$$?: DataPacketItem[];
    disabled?: boolean;
    /**
     * If true, node auto-executes when inputData.timestamp changes
     * This enables reactive chain execution
     */
    autoExecutionEnabled?: boolean;
    createdAt?: string;
    updatedAt?: string;

    // ============================================================================
    // Port-specific fields (when stereo === 'port')
    // ============================================================================
    /** Parent node ID (for port nodes) */
    parentId?: string;
    /** Port direction */
    direction?: 'in' | 'out';
    /** Data type of the port */
    dataType?: string;
    /** Port data (for port nodes) */
    data$?: PortData;
    /** Child number for port node */
    childNo?: number;

    // ============================================================================
    // isFrontend flag (from server response)
    // ============================================================================
    /**
     * If 1, this is a frontend node (executes on client)
     * If 0 or undefined, this is a backend node (executes on server)
     */
    isFrontend?: 0 | 1;
}

/**
 * BlockHead - common head of block model
 */
export interface BlockHead {
    id?: string;
    name?: string;
}

/**
 * NodeView - view representation of node model
 */
export interface NodeView extends Partial<NodeModel> {}

/**
 * NodeBody - body for node creation/update
 */
export interface NodeBody extends Partial<NodeView> {
    name: string;
    flowId: string;
    blockId: string;
}

/**
 * InputOverrideItem - input override item for execution
 */
export interface InputOverrideItem {
    portId: string;
    packet: {
        value: unknown;
        type: string;
        timestamp?: number;
    };
}

/**
 * doPostRunParam - parameters for flow run endpoint
 */
export interface RunFlowParams {
    nodeId: string;
    propagate?: boolean;
}

/**
 * doPostRunBody - body for flow run endpoint
 */
export interface RunFlowBody {
    inputOverrides?: InputOverrideItem[];
}

/**
 * doPostStopParam - parameters for flow stop endpoint
 */
export interface StopFlowParams {
    nodeId?: string;
}

/**
 * SaveFlowBody - body for saving flow snapshot
 * Extends WorkflowState format: { nodes: NodeData[], edges: EdgeData[] }
 *
 * @see eureka-flows-api POST /flows/:id/save
 */
export interface SaveFlowBody {
    nodes: NodeData[];
    edges: EdgeData[];
    /** @deprecated Use edges instead */
    connections?: EdgeData[];
}

/**
 * SaveFlowView - response from save flow snapshot
 *
 * Server v0.26.213+ returns both formats:
 * - `nodes`, `edges`, `ports` (preferred)
 * - `nodes$$`, `edges$$`, `ports$$` (deprecated)
 *
 * @see eureka-flows-api POST /flows/:id/save, /upsert, /load response
 */
export interface SaveFlowView extends FlowView {
    /** List of nodes (preferred) */
    nodes?: NodeData[];
    /** List of edges (preferred) */
    edges?: EdgeData[];
    /** List of ports (preferred) */
    ports?: NodeView[];

    /** @deprecated use `nodes` instead */
    nodes$$?: NodeView[];
    /** @deprecated use `edges` instead */
    edges$$?: EdgeView[];
    /** @deprecated use `ports` instead */
    ports$$?: NodeView[];
}

/**
 * UpsertNodeResult - compatibility result from flow-level canvas updates.
 *
 * Response uses SaveFlowView format (no $$ suffix):
 * - nodes: NodeData[] (created/updated nodes with server-assigned IDs)
 * - edges: EdgeData[] (created/updated edges with server-assigned IDs)
 *
 */
export interface UpsertNodeResult {
    nodes: NodeData[];
    edges?: EdgeData[];
}

/**
 * LoadFlowPortData - port data from GET /flows/{flowId} response
 *
 * Unlike PortDataResponse, this type
 * has nullable data field because the server may return data: null
 * when port data hasn't been populated yet.
 *
 * @example
 * {
 *   "id": "1004298:in",
 *   "nodeId": "1004298",
 *   "portId": "in",
 *   "data": null  // or { value, type, timestamp }
 * }
 */
export interface LoadFlowPortData {
    /** Full port ID (e.g., "1004298:in") */
    id: string;
    /** Parent node ID (e.g., "1004298") */
    nodeId: string;
    /** Port name/key (e.g., "in" or "out") */
    portId: string;
    /** Port data - null when not populated, DataPacket when available */
    data: DataPacket | null;
}

/**
 * LoadFlowResult - result of loading flow snapshot
 * GET /flows/:id/load returns SaveFlowBody format
 *
 * Uses NodeData/EdgeData from API package to match backend response format.
 * - NodeData: uses object format for config, inputData, outputData
 * - EdgeData: connection data between nodes
 * - LoadFlowPortData: port data with current values (may be null)
 * - channelId: WebSocket channel for real-time updates
 */
export interface LoadFlowResult extends FlowModel {
    nodes: NodeData[];
    edges: EdgeData[];
    /** Port data with current values for input/output ports (data may be null) */
    ports?: LoadFlowPortData[];
    /** WebSocket channel ID for real-time node status updates */
    channelId?: string;
}

/**
 * ApiListResult - generic list result from API
 */
export interface ApiListResult<T> {
    list: T[];
    total?: number;
    page?: number;
    limit?: number;
}

/**
 * API error codes
 */
export type ApiErrorCode =
    | 'NETWORK_ERROR'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'VALIDATION_ERROR'
    | 'SERVER_ERROR'
    | 'TIMEOUT'
    | 'UNKNOWN';

/**
 * Structured API error
 */
export interface ApiError {
    code: ApiErrorCode;
    message: string;
    status?: number;
    details?: Record<string, unknown>;
}

/**
 * Flow-specific error codes
 */
export type FlowErrorCode =
    | 'FLOW_NOT_FOUND'
    | 'NODE_NOT_FOUND'
    | 'EDGE_NOT_FOUND'
    | 'EXECUTION_FAILED'
    | 'EXECUTION_TIMEOUT'
    | 'INVALID_CONNECTION'
    | 'CIRCULAR_DEPENDENCY';

/**
 * Flow execution error
 */
export interface FlowExecutionError {
    code: FlowErrorCode;
    message: string;
    nodeId?: string;
    flowId?: string;
    details?: Record<string, unknown>;
}

/**
 * Type guard for ApiError
 */
export const isApiError = (error: unknown): error is ApiError => {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        'message' in error &&
        typeof (error as ApiError).code === 'string' &&
        typeof (error as ApiError).message === 'string'
    );
};

/**
 * Type guard for FlowExecutionError
 */
export const isFlowExecutionError = (error: unknown): error is FlowExecutionError => {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        'message' in error &&
        typeof (error as FlowExecutionError).code === 'string' &&
        typeof (error as FlowExecutionError).message === 'string'
    );
};

// ============================================================================
// Flow Metadata API Types (v0.26.126)
// ============================================================================

/**
 * UpdateFlowBody - body for updating flow metadata
 * POST /flows/:id
 *
 * @see eureka-flows-api v0.26.126
 * @deprecated Use PutFlowBody with PUT /flows/{flowId}
 */
export interface UpdateFlowBody {
    name?: string;
}

// ============================================================================
// New Spec Flow Types (spec v2 API)
// ============================================================================

export type FlowStatus = 'DRAFT' | 'READY' | 'ARCHIVED';

/** Flow summary returned by GET /flows, POST /flows, PUT /flows/{flowId} */
export interface FlowSummary {
    flowId: string;
    title: string;
    description?: string;
    status: FlowStatus;
    createdAt: string;
    updatedAt: string;
    latestProposalId?: string;
    lastRunId?: string;
}

/** Full flow detail returned by GET /flows/{flowId} */
export interface FlowDetail extends FlowSummary {
    nodes: NodeData[];
    edges: EdgeData[];
}

/** Body for POST /flows */
export interface CreateFlowBody {
    title: string;
    description?: string;
    scenario?: string;
}

/** Body for PUT /flows/{flowId} */
export interface PutFlowBody {
    title?: string;
    description?: string;
    nodes: NodeData[];
    edges: EdgeData[];
}

/** Query params for GET /flows */
export interface FlowListParams {
    limit?: number;
    cursor?: string;
    status?: FlowStatus;
}

/** Response from GET /flows */
export interface FlowListResult {
    items: FlowSummary[];
    nextCursor?: string;
}

/** Response from DELETE /flows/{flowId} */
export interface DeleteFlowResult {
    deleted: true;
    messagesDeleted: number;
    proposalsDeleted: number;
}

/** Block spec item from GET /blocks and GET /blocks/{blockType} */
export interface BlockSpec {
    blockType: string;
    name: string;
    description?: string;
    category: 'input' | 'process' | 'output';
    inputSchema?: unknown[];
    outputSchema?: unknown[];
    estimatedCost?: number;
    configFields?: unknown[];
}

// ============================================================================
// Image API Types (v0.26.126)
// ============================================================================

/**
 * S3ImageInfo - parsed S3 URL information for browser-side asset display.
 */
export interface S3ImageInfo {
    s3Url: string;
    parsed: {
        bucket: string;
        key: string;
        md5: string;
        sizeKb: number;
        ext: string;
        prefix?: string;
    };
    allowed: boolean;
}

/**
 * BinaryImageResponse - compatibility shape for binary image payloads.
 */
export interface BinaryImageResponse {
    $binary: true;
    statusCode: number;
    headers: {
        'Content-Type': string;
        'Content-Length': string;
        'Cache-Control': string;
        ETag: string;
    };
    body: string; // base64 encoded
    isBase64Encoded: true;
}

// ============================================================================
// System Info API Types
// ============================================================================

/**
 * SystemComponent - component version info from backend
 * GET / (root endpoint) response
 */
export interface SystemComponent {
    name: string;
    version: string;
}

/**
 * SystemInfo - system information response
 * GET / (root endpoint)
 */
export interface SystemInfo {
    components: SystemComponent[];
}
