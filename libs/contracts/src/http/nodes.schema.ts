/**
 * Legacy /nodes/* HTTP endpoints were removed in P3.
 *
 * Current canvas persistence is owned by:
 * - GET /flows/{flowId}
 * - PUT /flows/{flowId}
 * - POST /flows/{flowId}/nodes/{nodeId}/runs for single-node execution
 * - GET /runs/{runId}/nodes/{nodeId} for run-node output lookup
 */
export {};
