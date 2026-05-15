import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Loader2, Play } from 'lucide-react';

import {
    EXECUTE_FUNCTIONS,
    createFlowRun,
    getPortData,
    getRun,
    getRunNodes,
    listFlowRuns,
    useBlocks,
    useCanvasStore,
    useFlows,
} from '@flows/flows';
import { ApiKeyDialog } from '@flows/shared';
import { useInitFlowSocket } from '@flows/socket';
import { useWebCoreStore } from '@flows/web-core';

import { type WorkflowRunStatus, getWorkflowRunMode, isWorkflowRunButtonDisabled } from './run-mode';
import { FlowAgentPanel } from '../components/FlowAgentPanel';
import { Header } from '../components/Header';
import { HelpDialog } from '../components/HelpDialog';
import { Sidebar } from '../components/Sidebar';
import { WorkflowCanvas } from '../components/WorkflowCanvas';

import type { HelpTab } from '../components/help';
import type { SidebarRef } from '../components/Sidebar';
import type { WorkflowCanvasRef } from '../components/WorkflowCanvas';
import type { EdgeData, NodeData } from '@flows/flows';
import type {
    NodeUpdateInfo,
    PortUpdateInfo,
    ProposalCreatedMessage,
    RunCompletedMessage,
    RunFailedMessage,
    RunStartedMessage,
} from '@flows/socket';

const serializeWorkflowState = (data: { nodes?: unknown[]; connections?: unknown[]; edges?: unknown[] }): string =>
    JSON.stringify({ nodes: data.nodes ?? [], connections: data.connections ?? data.edges ?? [] });

const isInputElement = (target: EventTarget | null): boolean => {
    if (!target || !(target instanceof HTMLElement)) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
};

type RunNodeSnapshot = Awaited<ReturnType<typeof getRunNodes>>[number];
type RunActivity = {
    nodeLabel?: string;
    progress?: number;
    state?: 'queued' | 'running' | 'reviewing' | 'completed' | 'failed';
    message?: string;
    error?: string | null;
};

type RunReviewSummary = {
    stoppedForReview?: boolean;
    reviewNodeId?: string;
    message?: string;
};

const RUN_NODE_POLL_MS = 1500;
const BOOT_CANVAS_RETRY_MS = 25;
const BOOT_CANVAS_MAX_ATTEMPTS = 200;

type PendingWorkflowLoad = {
    loadedId: string | null;
    nodeId: string | null;
    initialFlow: Parameters<WorkflowCanvasRef['loadWorkflow']>[0] | null;
};

const mapRunNodeStatusToCanvasState = (
    status: RunNodeSnapshot['status']
): 'IDLE' | 'READY' | 'RUNNING' | 'COMPLETED' | 'ERROR' => {
    if (status === 'RUNNING') return 'RUNNING';
    if (status === 'COMPLETED') return 'COMPLETED';
    if (status === 'FAILED' || status === 'CANCELLED') return 'ERROR';
    return 'IDLE';
};

const getRunNodeProgress = (node: RunNodeSnapshot): number =>
    Number.isFinite(node.progress) ? Math.min(100, Math.max(0, node.progress)) : 0;

const getRunNodeActivityMessage = (node: RunNodeSnapshot): string | undefined => {
    const progress = getRunNodeProgress(node);
    if (node.status === 'PENDING') return `${node.label} 실행 대기 중`;
    if (node.status === 'COMPLETED') return `${node.label} 완료`;
    if (node.status === 'FAILED' || node.status === 'CANCELLED') {
        return node.errorMessage ?? node.errorCode ?? `${node.label} 실패`;
    }

    if (node.blockType === 'media-image') {
        return `이미지 생성 중... ${progress}%`;
    }
    if (node.blockType === 'media-tts') {
        return `TTS 음성 생성 중... ${progress}%`;
    }
    if (node.blockType === 'media-video') {
        return `쇼츠 영상 합성 중... ${progress}%`;
    }
    if (node.blockType === 'content') {
        return `대본 작성 중... ${progress}%`;
    }
    if (node.blockType === 'search') {
        return `원문과 관련 자료 수집 중... ${progress}%`;
    }
    return `${node.label} 실행 중... ${progress}%`;
};

const toOutputPacket = (node: RunNodeSnapshot) => {
    if (node.outputPayload === undefined || node.outputPayload === null) return undefined;
    const valueType = typeof node.outputPayload;
    const packetType =
        valueType === 'string' ? 'text' : valueType === 'number' || valueType === 'boolean' ? 'any' : 'json';
    return {
        out: {
            value: node.outputPayload,
            type: packetType,
            timestamp: node.completedAt ? Date.parse(node.completedAt) : Date.now(),
        },
    };
};

const isStoppedForReviewSummary = (summary: unknown): summary is RunReviewSummary => {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false;
    return (summary as RunReviewSummary).stoppedForReview === true;
};

const getScriptReviewWaitingMessage = (message?: string): string => {
    if (!message || message === 'Script review step completed') {
        return '대본 단계가 완료되었습니다. 대본 노드에서 검수본을 저장한 뒤 검수본으로 이어서 실행 버튼을 누르면 이미지, TTS, 영상 합성이 이어집니다.';
    }
    return message;
};

export const FlowEditorPage = () => {
    const { t } = useTranslation(['flows']);
    const canvasRef = useRef<WorkflowCanvasRef>(null);
    const sidebarRef = useRef<SidebarRef>(null);

    const { loadBlocks, blockRegistry } = useBlocks();
    const {
        currentFlowId,
        flowName,
        isLoading,
        isSaving,
        lastSavedAt,
        isAutoSaveEnabled,
        saveStatus,
        saveError,
        channelId,
        initializeFlow,
        loadFlowById,
        saveCurrentFlow,
        createNewFlow,
        retrySave,
        toggleAutoSave,
        updateFlowName,
    } = useFlows();

    const [isAgentOpen, setIsAgentOpen] = useState(false);
    const [runStatus, setRunStatus] = useState<WorkflowRunStatus>(null);
    const [runActivity, setRunActivity] = useState<RunActivity | null>(null);
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const activeRunScriptReviewFirstRef = useRef(false);
    const [latestProposal, setLatestProposal] = useState<ProposalCreatedMessage | null>(null);
    const [pendingWorkflowLoad, setPendingWorkflowLoad] = useState<PendingWorkflowLoad | null>(null);

    const resetRunUi = useCallback(() => {
        setRunStatus(null);
        setRunActivity(null);
        setActiveRunId(null);
        activeRunScriptReviewFirstRef.current = false;
        setLatestProposal(null);
        setPendingWorkflowLoad(null);
    }, []);

    const getCanvasNodeLabel = useCallback(
        (nodeId: string): string => {
            const node = canvasRef.current?.getWorkflow()?.nodes?.find(item => item.id === nodeId);
            const definition = node?.type ? blockRegistry[node.type] : undefined;
            return node?.customLabel ?? node?.name ?? definition?.label ?? nodeId;
        },
        [blockRegistry]
    );

    const setScriptReviewWaitingState = useCallback(
        (summary?: RunReviewSummary) => {
            setRunStatus('reviewing');
            setRunActivity({
                nodeLabel: summary?.reviewNodeId ? getCanvasNodeLabel(summary.reviewNodeId) : '대본 검수 대기',
                progress: 100,
                state: 'reviewing',
                message: getScriptReviewWaitingMessage(summary?.message),
            });
            setIsAgentOpen(true);
        },
        [getCanvasNodeLabel]
    );

    const applyRunNodeSnapshots = useCallback(
        (
            runNodes: RunNodeSnapshot[],
            options?: { preserveTerminalStatus?: boolean }
        ): Exclude<WorkflowRunStatus, 'reviewing'> => {
            const visibleRunNodes = runNodes.filter(node => !node.nodeId.startsWith('port_'));
            if (visibleRunNodes.length === 0) return null;

            for (const runNode of visibleRunNodes) {
                const state = mapRunNodeStatusToCanvasState(runNode.status);
                const startedAtMs = runNode.startedAt ? Date.parse(runNode.startedAt) : undefined;
                const completedAtMs = runNode.completedAt ? Date.parse(runNode.completedAt) : undefined;
                const duration =
                    startedAtMs && completedAtMs && completedAtMs >= startedAtMs
                        ? completedAtMs - startedAtMs
                        : undefined;
                const outputData = runNode.status === 'COMPLETED' ? toOutputPacket(runNode) : undefined;

                canvasRef.current?.updateNodeFromServer(runNode.nodeId, {
                    state,
                    status: state,
                    errorMessage: runNode.errorMessage ?? runNode.errorCode ?? undefined,
                    executionStats: {
                        progress: getRunNodeProgress(runNode),
                        ...(startedAtMs ? { startTime: startedAtMs } : {}),
                        ...(duration !== undefined ? { duration } : {}),
                    },
                    ...(outputData ? { outputData } : {}),
                });
            }

            const failedNode = visibleRunNodes.find(node => node.status === 'FAILED' || node.status === 'CANCELLED');
            if (failedNode) {
                setRunStatus('failed');
                setRunActivity({
                    nodeLabel: getCanvasNodeLabel(failedNode.nodeId),
                    progress: getRunNodeProgress(failedNode) || 100,
                    state: 'failed',
                    message: getRunNodeActivityMessage(failedNode),
                    error:
                        failedNode.errorMessage ??
                        failedNode.errorCode ??
                        (failedNode.status === 'CANCELLED' ? '사용자가 실행을 취소했습니다.' : '노드 실행 실패'),
                });
                return 'failed';
            }

            const runningNode = visibleRunNodes.find(node => node.status === 'RUNNING');
            const pendingNode = visibleRunNodes.find(node => node.status === 'PENDING');
            const completedCount = visibleRunNodes.filter(node => node.status === 'COMPLETED').length;
            const progressFromCount = Math.round((completedCount / visibleRunNodes.length) * 100);

            if (runningNode) {
                setRunStatus('running');
                setRunActivity({
                    nodeLabel: getCanvasNodeLabel(runningNode.nodeId),
                    progress: Math.max(progressFromCount, getRunNodeProgress(runningNode)),
                    state: 'running',
                    message: getRunNodeActivityMessage(runningNode),
                });
                return 'running';
            }

            if (pendingNode) {
                setRunStatus('running');
                setRunActivity({
                    nodeLabel: `${completedCount}/${visibleRunNodes.length} 완료, 대기: ${getCanvasNodeLabel(pendingNode.nodeId)}`,
                    progress: progressFromCount,
                    state: 'queued',
                    message: getRunNodeActivityMessage(pendingNode),
                });
                return 'running';
            }

            if (!options?.preserveTerminalStatus) {
                setRunStatus('completed');
                setRunActivity({
                    nodeLabel: '전체 워크플로우',
                    progress: 100,
                    state: 'completed',
                });
            }
            return 'completed';
        },
        [getCanvasNodeLabel]
    );

    const hydrateLatestRunForFlow = useCallback(
        async (flowId: string) => {
            try {
                const [latestRun] = await listFlowRuns(flowId, 1);
                if (!latestRun || latestRun.status === 'CANCELLED') return;

                const [run, runNodes] = await Promise.all([getRun(latestRun.runId), getRunNodes(latestRun.runId)]);
                const reviewSummary = isStoppedForReviewSummary(run.finalOutputSummary)
                    ? run.finalOutputSummary
                    : undefined;
                const derivedStatus = applyRunNodeSnapshots(runNodes, {
                    preserveTerminalStatus: !!reviewSummary,
                });

                if (latestRun.status === 'QUEUED' || latestRun.status === 'RUNNING') {
                    setActiveRunId(latestRun.runId);
                    if (!derivedStatus) {
                        setRunStatus('running');
                        setRunActivity({
                            nodeLabel: `실행 ${latestRun.runId}`,
                            progress: 0,
                            state: latestRun.status === 'QUEUED' ? 'queued' : 'running',
                            message:
                                latestRun.status === 'QUEUED'
                                    ? '워크플로우 실행이 대기 중입니다.'
                                    : '워크플로우 실행 상태를 복구했습니다.',
                        });
                    }
                    return;
                }

                if (latestRun.status === 'COMPLETED') {
                    setActiveRunId(null);
                    if (reviewSummary) {
                        setScriptReviewWaitingState(reviewSummary);
                        return;
                    }
                    setRunStatus('completed');
                    setRunActivity({
                        nodeLabel: '전체 워크플로우',
                        progress: 100,
                        state: 'completed',
                        message: '최근 실행 결과를 불러왔습니다.',
                    });
                    return;
                }

                if (latestRun.status === 'FAILED') {
                    setActiveRunId(null);
                    setRunStatus('failed');
                    if (!derivedStatus) {
                        setRunActivity({
                            nodeLabel: '전체 워크플로우',
                            progress: 100,
                            state: 'failed',
                            message: '최근 실행이 실패했습니다.',
                            error: '실패한 실행 결과를 불러왔습니다.',
                        });
                    }
                }
            } catch (error) {
                console.debug('[FlowEditor] Failed to hydrate latest run:', error);
            }
        },
        [applyRunNodeSnapshots, setScriptReviewWaitingState]
    );

    // Handle flow update notification from WebSocket (new format)
    // Fetches entire flow from server and updates canvas
    const handleFlowUpdate = useCallback(
        async (flowId: string) => {
            try {
                const flowData = await loadFlowById(flowId);
                if (canvasRef.current && flowData) {
                    await canvasRef.current.loadWorkflow(flowData);
                    lastSavedStateRef.current = serializeWorkflowState(flowData);
                }
            } catch (error) {
                console.error('[FlowEditor] Failed to reload flow:', error);
            }
        },
        [loadFlowById]
    );

    // Track node sequence numbers to detect stale updates (higher no = newer)
    const nodeNoRef = useRef<Map<string, number>>(new Map());

    const handleNodeUpdate = useCallback(
        async (info: NodeUpdateInfo) => {
            const { nodeId, flowId, isPort, parentNodeId, state, progress, no, message, errorCode, errorMessage } =
                info;

            // Skip if flowId is missing or doesn't match current flow (socket channel is shared)
            if (!flowId || flowId !== currentFlowId) return;

            // Check if this update is stale based on sequence number (no)
            // Higher 'no' means more recent - skip if we've seen equal or higher number
            if (no !== undefined) {
                const prevNo = nodeNoRef.current.get(nodeId);
                if (prevNo !== undefined && prevNo >= no) {
                    console.debug('[handleNodeUpdate] Skipping stale update:', nodeId, 'prevNo:', prevNo, 'no:', no);
                    return;
                }
                nodeNoRef.current.set(nodeId, no);
            }

            if (!canvasRef.current) return;

            // Skip port updates from type:'node' messages (deprecated pattern)
            // Port updates are handled by type:'node/port' messages via handlePortUpdate
            if (isPort && parentNodeId) {
                if (state) {
                    canvasRef.current.updateNodeFromServer(parentNodeId, {
                        state,
                        status: state,
                    });
                }
                return;
            }

            // ERROR state: socket node.failed includes the failure details after P3.
            if (state === 'ERROR') {
                setRunStatus('failed');
                setRunActivity({
                    nodeLabel: getCanvasNodeLabel(nodeId),
                    progress: progress ?? 100,
                    state: 'failed',
                    message,
                    error: errorMessage ?? errorCode ?? '노드 실행 실패',
                });
                canvasRef.current.updateNodeFromServer(nodeId, {
                    state,
                    status: state,
                    errorMessage: errorMessage ?? errorCode,
                });
                return;
            }

            // All other states: use socket data directly (no API fetch needed)
            const executionStats =
                state === 'RUNNING'
                    ? { startTime: Date.now(), duration: 0, progress: progress ?? 0 }
                    : progress !== undefined
                      ? { progress }
                      : undefined;

            canvasRef.current.updateNodeFromServer(nodeId, {
                state,
                status: state,
                executionStats,
            });

            if (state === 'RUNNING') {
                setRunStatus('running');
                setRunActivity({
                    nodeLabel: getCanvasNodeLabel(nodeId),
                    progress: progress ?? 0,
                    state: 'running',
                    message,
                });
            } else if (state === 'COMPLETED') {
                setRunActivity({
                    nodeLabel: getCanvasNodeLabel(nodeId),
                    progress: 100,
                    state: 'completed',
                    message,
                });
            }

            // Auto-execute isFrontend nodes when READY (if all inputs have data)
            if (state !== 'READY') return;

            const workflow = canvasRef.current.getWorkflow();
            const node = workflow?.nodes?.find(n => n.id === nodeId);
            if (!node?.type) return;

            const nodeDef = blockRegistry[node.type];
            if (!nodeDef?.isFrontend || !EXECUTE_FUNCTIONS[nodeDef.type]) return;

            // Skip input blocks (require user interaction, no upstream data propagation)
            if (nodeDef.stereo === 'input') return;

            // Skip if required inputs don't have data (upstream not executed yet)
            const hasAllInputs = (nodeDef.inputs ?? []).every(input => node.inputData?.[input.id]?.value !== undefined);
            if (!hasAllInputs) return;

            // Defer execution to next tick to prevent blocking socket handler
            setTimeout(() => {
                canvasRef.current?.executeNode(nodeId);
            }, 0);
        },
        [blockRegistry, currentFlowId, getCanvasNodeLabel]
    );

    // Track port sequence numbers to detect stale updates (higher no = newer)
    const portNoRef = useRef<Map<string, number>>(new Map());

    // Get port highlight actions from canvas store
    const setUpdatedPort = useCanvasStore(state => state.setUpdatedPort);
    const clearUpdatedPort = useCanvasStore(state => state.clearUpdatedPort);

    // Track highlight timeouts per port to cancel previous timeout on rapid updates
    const highlightTimeoutsRef = useRef<Map<string, number>>(new Map());

    /**
     * Handle port update notification from WebSocket (type: 'node/port')
     * - Output ports: always fetch data and update outputData
     * - Input ports: only fetch for terminal nodes (output$ is empty)
     *   - Terminal nodes (미리보기, 디버그 로그): need inputData to display
     *   - Non-terminal nodes: skip fetch (data same as upstream output)
     */
    const handlePortUpdate = useCallback(
        async (info: PortUpdateInfo) => {
            const { portId, nodeId, flowId, portName, direction, no } = info;

            // Skip if flowId is missing or doesn't match current flow (socket channel is shared)
            if (!flowId || flowId !== currentFlowId) return;

            // Check if this update is stale based on sequence number (no)
            // Higher 'no' means more recent - skip if we've seen equal or higher number
            if (no !== undefined) {
                const prevNo = portNoRef.current.get(portId);
                if (prevNo !== undefined && prevNo >= no) {
                    console.debug('[handlePortUpdate] Skipping stale update:', portId, 'prevNo:', prevNo, 'no:', no);
                    return;
                }
                portNoRef.current.set(portId, no);
            }

            // Trigger port highlight
            const existingTimeout = highlightTimeoutsRef.current.get(portId);
            if (existingTimeout) {
                window.clearTimeout(existingTimeout);
            }
            setUpdatedPort(portId);
            const timeoutId = window.setTimeout(() => {
                clearUpdatedPort(portId);
                highlightTimeoutsRef.current.delete(portId);
            }, 500);
            highlightTimeoutsRef.current.set(portId, timeoutId);

            if (!canvasRef.current) return;

            const resolvedDirection = direction ?? (portName === 'out' ? 'out' : 'in');
            const isOutputPort = resolvedDirection === 'out';

            // For input ports, check if this is a terminal node (no outputs)
            // Terminal nodes need inputData to display, others can skip (data same as upstream)
            if (!isOutputPort) {
                const workflow = canvasRef.current.getWorkflow();
                const nodeInCanvas = workflow?.nodes?.find(n => n.id === nodeId);
                if (nodeInCanvas?.type) {
                    const nodeDef = blockRegistry[nodeInCanvas.type];
                    const isTerminalNode = !nodeDef?.output$ || nodeDef.output$.length === 0;
                    if (!isTerminalNode) {
                        // Non-terminal node: skip fetch (data same as upstream output)
                        return;
                    }
                }
            }

            try {
                const portData = await getPortData(portId, resolvedDirection, flowId);

                if (portData?.data) {
                    const dataPacket = {
                        value: portData.data.value,
                        type: portData.data.type,
                        timestamp: portData.data.timestamp,
                    };

                    const portKey = portData.portId || portName || resolvedDirection;

                    if (isOutputPort) {
                        canvasRef.current.updateNodeFromServer(nodeId, {
                            outputData: { [portKey]: dataPacket },
                        });
                    } else {
                        canvasRef.current.updateNodeFromServer(nodeId, {
                            inputData: { [portKey]: dataPacket },
                        });
                    }
                }
            } catch (error) {
                // Revert no on failure to allow retry
                if (no !== undefined) {
                    const prevNo = portNoRef.current.get(portId);
                    if (prevNo === no) {
                        portNoRef.current.delete(portId);
                    }
                }
                console.debug('[handlePortUpdate] Failed to fetch port data:', portId, error);
            }
        },
        [setUpdatedPort, clearUpdatedPort, blockRegistry, currentFlowId]
    );

    // Cleanup highlight timeouts on unmount
    useEffect(() => {
        const timeoutsMap = highlightTimeoutsRef.current;
        return () => {
            timeoutsMap.forEach(timeoutId => {
                window.clearTimeout(timeoutId);
            });
            timeoutsMap.clear();
        };
    }, []);

    const handleProposalCreated = useCallback((message: ProposalCreatedMessage) => {
        setLatestProposal(message);
        setIsAgentOpen(true);
    }, []);

    const handleRunStarted = useCallback((message: RunStartedMessage) => {
        if (message.runId) setActiveRunId(message.runId);
        setRunStatus('running');
        setRunActivity({
            nodeLabel: message.runId ? `실행 ${message.runId}` : '워크플로우 실행',
            progress: 0,
            state: 'running',
            message: '워크플로우 실행을 시작했습니다.',
        });
        setIsAgentOpen(true);
    }, []);

    const handleRunCompleted = useCallback(
        (message: RunCompletedMessage) => {
            const runId = message.runId ?? activeRunId;
            if (runId) {
                void Promise.all([getRun(runId), getRunNodes(runId)])
                    .then(([run, runNodes]) => {
                        const reviewSummary = isStoppedForReviewSummary(run.finalOutputSummary)
                            ? run.finalOutputSummary
                            : undefined;
                        applyRunNodeSnapshots(runNodes, {
                            preserveTerminalStatus: !!reviewSummary || activeRunScriptReviewFirstRef.current,
                        });
                        setActiveRunId(null);

                        if (reviewSummary || activeRunScriptReviewFirstRef.current) {
                            setScriptReviewWaitingState(
                                reviewSummary ?? {
                                    stoppedForReview: true,
                                    message: message.message,
                                }
                            );
                            return;
                        }

                        activeRunScriptReviewFirstRef.current = false;
                        setRunStatus('completed');
                        setRunActivity({
                            nodeLabel: '전체 워크플로우',
                            progress: 100,
                            state: 'completed',
                            message: message.message ?? '모든 노드 실행이 끝났습니다.',
                        });
                    })
                    .catch(error => {
                        console.debug('[FlowEditor] Failed to refresh completed run nodes:', error);
                        setActiveRunId(null);
                        if (activeRunScriptReviewFirstRef.current) {
                            setScriptReviewWaitingState({
                                stoppedForReview: true,
                                message: message.message,
                            });
                            return;
                        }
                        activeRunScriptReviewFirstRef.current = false;
                        setRunStatus('completed');
                        setRunActivity({
                            nodeLabel: '전체 워크플로우',
                            progress: 100,
                            state: 'completed',
                            message: message.message ?? '모든 노드 실행이 끝났습니다.',
                        });
                    });
                return;
            }
            setActiveRunId(null);
            activeRunScriptReviewFirstRef.current = false;
            setRunStatus('completed');
            setRunActivity({
                nodeLabel: '전체 워크플로우',
                progress: 100,
                state: 'completed',
                message: message.message ?? '모든 노드 실행이 끝났습니다.',
            });
        },
        [activeRunId, applyRunNodeSnapshots, setScriptReviewWaitingState]
    );

    const handleRunFailed = useCallback(
        (message: RunFailedMessage) => {
            setActiveRunId(null);
            activeRunScriptReviewFirstRef.current = false;
            setRunStatus('failed');
            setRunActivity({
                nodeLabel: message.failedNodeId ? getCanvasNodeLabel(message.failedNodeId) : '전체 워크플로우',
                progress: 100,
                state: 'failed',
                error: message.errorMessage ?? message.error ?? message.errorCode ?? '워크플로우 실행 실패',
            });
            setIsAgentOpen(true);
        },
        [getCanvasNodeLabel]
    );

    // Track last local update to prevent self-echo from socket (use ref to avoid re-renders)
    const lastLocalUpdateTimestampRef = useRef<number | null>(null);
    const getLastLocalUpdateTimestamp = useCallback(() => lastLocalUpdateTimestampRef.current, []);

    // Initialize WebSocket connection when channelId is available
    const {
        isConnected: isSocketConnected,
        connectionStatus: socketStatus,
        reconnect: socketReconnect,
        reconnectAttempts,
        maxReconnectReached,
    } = useInitFlowSocket({
        channelId,
        currentFlowId,
        getLastLocalUpdateTimestamp,
        onFlowUpdate: handleFlowUpdate,
        onNodeReload: handleNodeUpdate,
        onPortUpdate: handlePortUpdate,
        onProposalCreated: handleProposalCreated,
        onRunStarted: handleRunStarted,
        onRunCompleted: handleRunCompleted,
        onRunFailed: handleRunFailed,
    });

    useEffect(() => {
        if (!activeRunId) return;

        let cancelled = false;
        let timeoutId: number | null = null;

        const pollRunNodes = async () => {
            try {
                const [run, runNodes] = await Promise.all([getRun(activeRunId), getRunNodes(activeRunId)]);
                if (cancelled) return;

                const reviewSummary = isStoppedForReviewSummary(run.finalOutputSummary)
                    ? run.finalOutputSummary
                    : undefined;
                const derivedStatus = applyRunNodeSnapshots(runNodes, {
                    preserveTerminalStatus: !!reviewSummary || activeRunScriptReviewFirstRef.current,
                });

                if (run.status === 'FAILED') {
                    const summary = run.finalOutputSummary as
                        | { failedNodeId?: string; errorMessage?: string; errorCode?: string }
                        | null
                        | undefined;
                    setRunStatus('failed');
                    activeRunScriptReviewFirstRef.current = false;
                    setRunActivity({
                        nodeLabel: summary?.failedNodeId ? getCanvasNodeLabel(summary.failedNodeId) : '전체 워크플로우',
                        progress: 100,
                        state: 'failed',
                        message: '워크플로우 실행이 실패했습니다.',
                        error: summary?.errorMessage ?? summary?.errorCode ?? '워크플로우 실행 실패',
                    });
                    setActiveRunId(null);
                    return;
                }

                if (run.status === 'CANCELLED') {
                    setRunStatus('failed');
                    activeRunScriptReviewFirstRef.current = false;
                    setRunActivity({
                        nodeLabel: '전체 워크플로우',
                        progress: 100,
                        state: 'failed',
                        message: '워크플로우 실행이 취소되었습니다.',
                        error: '사용자가 실행을 취소했습니다.',
                    });
                    setActiveRunId(null);
                    return;
                }

                if (run.status === 'COMPLETED' || derivedStatus === 'completed') {
                    if (reviewSummary || activeRunScriptReviewFirstRef.current) {
                        setScriptReviewWaitingState(reviewSummary);
                        setActiveRunId(null);
                        return;
                    }
                    activeRunScriptReviewFirstRef.current = false;
                    setRunStatus('completed');
                    setRunActivity({
                        nodeLabel: '전체 워크플로우',
                        progress: 100,
                        state: 'completed',
                        message: '모든 노드 실행이 끝났습니다.',
                    });
                    setActiveRunId(null);
                    return;
                }
            } catch (error) {
                console.debug('[FlowEditor] Failed to poll run nodes:', error);
            }

            if (!cancelled) {
                timeoutId = window.setTimeout(pollRunNodes, RUN_NODE_POLL_MS);
            }
        };

        void pollRunNodes();

        return () => {
            cancelled = true;
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        };
    }, [activeRunId, applyRunNodeSnapshots, getCanvasNodeLabel, setScriptReviewWaitingState]);

    const [isAppReady, setIsAppReady] = useState(false);
    const [isBootError, setIsBootError] = useState(false);
    const [loadingText, setLoadingText] = useState('');
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
    const [isHelpDialogOpen, setIsHelpDialogOpen] = useState(false);
    const [isWorkflowRunning, setIsWorkflowRunning] = useState(false);
    const [isApplyingProposal, setIsApplyingProposal] = useState(false);
    const [helpDialogTab, setHelpDialogTab] = useState<HelpTab>('gettingStarted');
    const [agentBtnPos, setAgentBtnPos] = useState<{ x: number; y: number } | null>(null);
    const agentBtnDragRef = useRef<{ mouseX: number; mouseY: number; btnX: number; btnY: number } | null>(null);
    const agentBtnIsDraggingRef = useRef(false);

    const { apiKey, setApiKey } = useWebCoreStore();
    const autoSaveTimerRef = useRef<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const lastSavedStateRef = useRef<string | null>(null);

    const handleOpenLibrary = useCallback(() => {
        sidebarRef.current?.open();
    }, []);

    const handleApiKeySettings = useCallback(() => {
        setIsApiKeyDialogOpen(true);
    }, []);

    const handleOpenHelp = useCallback((tab: HelpTab = 'gettingStarted') => {
        setHelpDialogTab(tab);
        setIsHelpDialogOpen(true);
    }, []);

    const handleApiKeySubmit = useCallback(
        async (key: string): Promise<boolean> => {
            setApiKey(key);
            setIsApiKeyDialogOpen(false);
            return true;
        },
        [setApiKey]
    );

    const updateUrl = useCallback((flowId: string | null, nodeId?: string | null) => {
        try {
            let path = '/';
            if (flowId) path = `/flows/${flowId}`;
            const hash = nodeId ? `#${nodeId}` : '';
            const url = path + hash;

            if (window.location.pathname + window.location.hash !== url) {
                window.history.pushState({ flowId, nodeId }, '', url);
            }
        } catch {
            // ignore
        }
    }, []);

    const bootedRef = useRef(false);
    const bootCanvasLoadedRef = useRef(false);
    useEffect(() => {
        if (bootedRef.current) return;
        bootedRef.current = true;

        const boot = async () => {
            setLoadingText(t('flowEditor.initializingEngine'));
            try {
                setLoadingText(t('flowEditor.loadingBlockRegistry'));
                await loadBlocks();

                const pathParts = window.location.pathname.split('/');
                const flowIdFromUrl = pathParts.length > 2 && pathParts[1] === 'flows' ? pathParts[2] : null;
                const nodeIdFromHash = window.location.hash.replace('#', '') || null;

                let loadedId: string | null = null;
                let initialFlow = null;

                if (flowIdFromUrl) {
                    setLoadingText(t('flowEditor.loadingFlow', { flowId: flowIdFromUrl }));
                    initialFlow = await loadFlowById(flowIdFromUrl);
                    loadedId = flowIdFromUrl;
                } else {
                    setLoadingText(t('flowEditor.initializingFlow'));
                    const result = await initializeFlow();
                    loadedId = result.flowId;
                    initialFlow = result.flowData;

                    if (result.isNew) {
                        setLoadingText(t('flowEditor.createdNewFlow'));
                    }
                }

                setPendingWorkflowLoad({
                    loadedId,
                    nodeId: nodeIdFromHash,
                    initialFlow,
                });
                setIsAppReady(true);
            } catch (e) {
                setLoadingText(t('flowEditor.errorLoadingApp'));
                setIsBootError(true);
                console.error(e);
            }
        };

        boot();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- Boot runs once on mount, dependencies are stable singletons
    }, []);

    useEffect(() => {
        if (!isAppReady || !pendingWorkflowLoad || bootCanvasLoadedRef.current) return;

        let cancelled = false;
        let retryTimer: number | null = null;
        let attempts = 0;

        const loadWhenCanvasReady = async () => {
            if (cancelled || bootCanvasLoadedRef.current) return;

            const canvas = canvasRef.current;
            if (!canvas) {
                attempts += 1;
                if (attempts > BOOT_CANVAS_MAX_ATTEMPTS) {
                    console.error('[FlowEditor] Canvas ref was not ready during boot load');
                    return;
                }
                retryTimer = window.setTimeout(loadWhenCanvasReady, BOOT_CANVAS_RETRY_MS);
                return;
            }

            try {
                if (pendingWorkflowLoad.initialFlow) {
                    await canvas.loadWorkflow(pendingWorkflowLoad.initialFlow);
                    lastSavedStateRef.current = serializeWorkflowState(pendingWorkflowLoad.initialFlow);
                }

                if (pendingWorkflowLoad.loadedId) {
                    updateUrl(pendingWorkflowLoad.loadedId, pendingWorkflowLoad.nodeId);
                    void hydrateLatestRunForFlow(pendingWorkflowLoad.loadedId);
                }
                if (pendingWorkflowLoad.nodeId) {
                    canvas.selectNode(pendingWorkflowLoad.nodeId);
                }

                bootCanvasLoadedRef.current = true;
                setPendingWorkflowLoad(null);
            } catch (error) {
                console.error('[FlowEditor] Failed to load workflow:', error);
            }
        };

        void loadWhenCanvasReady();

        return () => {
            cancelled = true;
            if (retryTimer !== null) window.clearTimeout(retryTimer);
        };
    }, [hydrateLatestRunForFlow, isAppReady, pendingWorkflowLoad, updateUrl]);

    const triggerAutoSave = useCallback(() => {
        if (!isAutoSaveEnabled) return;

        if (autoSaveTimerRef.current) {
            window.clearTimeout(autoSaveTimerRef.current);
        }

        autoSaveTimerRef.current = window.setTimeout(() => {
            if (canvasRef.current) {
                const data = canvasRef.current.getWorkflow();
                const currentState = serializeWorkflowState(data);

                if (currentState !== lastSavedStateRef.current) {
                    lastLocalUpdateTimestampRef.current = Date.now(); // Mark save time to ignore self-echo
                    saveCurrentFlow(data);
                    lastSavedStateRef.current = currentState;
                }
            }
        }, 2000);
    }, [isAutoSaveEnabled, saveCurrentFlow]);

    const showNotification = (message: string, type: 'success' | 'error') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 3000);
    };

    const handleSave = async () => {
        if (!canvasRef.current) return;
        const data = canvasRef.current.getWorkflow();
        lastLocalUpdateTimestampRef.current = Date.now(); // Mark save time to ignore self-echo from socket
        const result = await saveCurrentFlow(data);
        if (result.success) {
            lastSavedStateRef.current = serializeWorkflowState(data);
            showNotification(t('flowEditor.savedAs', { flowName }), 'success');
            if (result.id !== currentFlowId) {
                updateUrl(result.id, window.location.hash.replace('#', ''));
            }
        } else {
            showNotification(t('flowEditor.failedToSaveWorkflow'), 'error');
        }
    };

    const handleNew = async () => {
        if (!canvasRef.current) return;
        if (window.confirm(t('flowEditor.confirmNewFlow'))) {
            canvasRef.current.newWorkflow();
            resetRunUi();
            lastSavedStateRef.current = serializeWorkflowState({ nodes: [], connections: [] });
            const newId = await createNewFlow();
            if (newId) {
                updateUrl(newId, null);
                showNotification(t('flowEditor.newFlowCreated'), 'success');
            } else {
                showNotification(t('flowEditor.failedToCreateFlow'), 'error');
            }
        }
    };

    const handleNameChange = async (newName: string) => {
        // Update flow name on server via POST /flows/:id
        await updateFlowName(newName);
    };

    const handleShare = async () => {
        if (canvasRef.current) {
            const data = canvasRef.current.getWorkflow();
            lastLocalUpdateTimestampRef.current = Date.now();
            await saveCurrentFlow(data);
        }

        try {
            await navigator.clipboard.writeText(window.location.href);
            showNotification(t('flowEditor.linkCopied'), 'success');
        } catch {
            showNotification(t('flowEditor.failedToCopyLink'), 'error');
        }
    };

    const handleClear = () => {
        if (!canvasRef.current) return;
        if (window.confirm(t('flowEditor.confirmClearCanvas'))) {
            canvasRef.current.clearWorkflow();
            resetRunUi();
            lastSavedStateRef.current = serializeWorkflowState({ nodes: [], connections: [] });
            lastLocalUpdateTimestampRef.current = Date.now();
            void saveCurrentFlow({ nodes: [], edges: [] }).then(result => {
                showNotification(
                    result.success ? t('flowEditor.canvasCleared') : t('flowEditor.failedToSaveWorkflow'),
                    result.success ? 'success' : 'error'
                );
            });
        }
    };

    const handleAddNode = useCallback((type: string) => {
        canvasRef.current?.addNode(type);
    }, []);

    const handleRunWorkflow = async () => {
        if (
            !canvasRef.current ||
            isApplyingProposal ||
            isWorkflowRunButtonDisabled({ isWorkflowRunning, isLoading, runStatus })
        ) {
            return;
        }

        setIsWorkflowRunning(true);
        try {
            const data = canvasRef.current.getWorkflow();
            if (!data.nodes || data.nodes.length === 0) {
                setIsAgentOpen(true);
                showNotification('실행할 블록이 없습니다. 먼저 제안을 승인해 캔버스에 배치해주세요.', 'error');
                return;
            }

            lastLocalUpdateTimestampRef.current = Date.now();
            const result = await saveCurrentFlow(data);
            if (!result.success || !result.id) {
                showNotification('워크플로우 저장 후 실행할 수 없습니다.', 'error');
                return;
            }

            if (result.id !== currentFlowId) {
                updateUrl(result.id, window.location.hash.replace('#', ''));
            }

            const { executionMode, scriptReviewFirst: runScriptReviewFirst } = getWorkflowRunMode(
                data.nodes as NodeData[] | undefined
            );
            activeRunScriptReviewFirstRef.current = runScriptReviewFirst;

            const run = await createFlowRun(result.id, {
                executionMode,
            });
            setActiveRunId(run.id);
            setRunStatus('running');
            setRunActivity({
                nodeLabel: `실행 ${run.id}`,
                progress: 0,
                state: 'queued',
                message: runScriptReviewFirst
                    ? '대본 검수 모드로 실행합니다. 대본 노드까지 완료되면 멈춥니다.'
                    : '전체 워크플로우 실행을 시작했습니다.',
            });
            setIsAgentOpen(true);
            showNotification(
                runScriptReviewFirst ? '대본 검수 모드로 실행을 시작했습니다.' : '워크플로우 실행을 시작했습니다.',
                'success'
            );
        } catch (error) {
            console.error('[FlowEditor] Failed to start flow run:', error);
            showNotification(error instanceof Error ? error.message : '워크플로우 실행 실패', 'error');
        } finally {
            setIsWorkflowRunning(false);
        }
    };

    const runButtonDisabled =
        isApplyingProposal || isWorkflowRunButtonDisabled({ isWorkflowRunning, isLoading, runStatus });

    const handleApproveProposal = useCallback(
        async (nodes: unknown[], edges: unknown[]) => {
            if (!canvasRef.current || (!nodes.length && !edges.length)) return;
            setIsApplyingProposal(true);
            try {
                await canvasRef.current.loadWorkflow({
                    nodes,
                    edges,
                } as Parameters<WorkflowCanvasRef['loadWorkflow']>[0]);

                const workflow = { nodes: nodes as NodeData[], edges: edges as EdgeData[] };
                lastLocalUpdateTimestampRef.current = Date.now();
                const result = await saveCurrentFlow(workflow);

                if (result.success) {
                    lastSavedStateRef.current = serializeWorkflowState(workflow);
                    if (result.id !== currentFlowId) {
                        updateUrl(result.id, window.location.hash.replace('#', ''));
                    }
                    showNotification('캔버스에 블록이 배치되고 저장되었습니다.', 'success');
                } else {
                    lastSavedStateRef.current = null;
                    showNotification('캔버스 배치는 완료됐지만 저장에 실패했습니다.', 'error');
                }
            } catch {
                showNotification('캔버스 업데이트 실패', 'error');
            } finally {
                setIsApplyingProposal(false);
            }
        },
        [currentFlowId, saveCurrentFlow, updateUrl]
    );

    const handleSelectionChange = (nodeId: string | null) => {
        updateUrl(currentFlowId, nodeId);
    };

    const handleCanvasChange = () => {
        lastLocalUpdateTimestampRef.current = Date.now(); // Mark change time to ignore self-echo from socket
        triggerAutoSave();
    };

    const handleConnectionError = useCallback(
        (error: 'cycle' | 'invalid_type') => {
            if (error === 'cycle') {
                showNotification(t('flowEditor.circularConnectionError'), 'error');
            }
        },
        [t]
    );

    const handleExport = () => {
        if (!canvasRef.current) return;

        const data = canvasRef.current.getWorkflow();
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `${flowName.replace(/\s+/g, '-').toLowerCase()}-${currentFlowId || Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showNotification(t('flowEditor.exportedToJson'), 'success');
    };

    const handleImport = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async event => {
            try {
                const json = JSON.parse(event.target?.result as string);
                if (canvasRef.current && json.nodes && (json.edges || json.connections)) {
                    await canvasRef.current.loadWorkflow(json);
                    lastSavedStateRef.current = null;
                    showNotification(t('flowEditor.workflowImported'), 'success');
                } else {
                    showNotification(t('flowEditor.invalidWorkflowFile'), 'error');
                }
            } catch {
                showNotification(t('flowEditor.failedToParseJson'), 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handlersRef = useRef({
        save: handleSave,
        new: handleNew,
        export: handleExport,
        showNotification,
        openHelp: handleOpenHelp,
    });
    handlersRef.current = {
        save: handleSave,
        new: handleNew,
        export: handleExport,
        showNotification,
        openHelp: handleOpenHelp,
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isInputElement(e.target)) return;

            // Handle ? key for help (Shift + / on most keyboards)
            if (e.key === '?' || (e.shiftKey && e.key === '/')) {
                e.preventDefault();
                handlersRef.current.openHelp('gettingStarted');
                return;
            }

            const isCtrlOrCmd = e.ctrlKey || e.metaKey;
            if (!isCtrlOrCmd) return;

            const key = e.key.toLowerCase();

            if (key === 's') {
                e.preventDefault();
                handlersRef.current.save();
            } else if (key === 'n') {
                e.preventDefault();
                handlersRef.current.new();
            } else if (key === 'e') {
                e.preventDefault();
                handlersRef.current.export();
            } else if (key === 'z' && !e.shiftKey) {
                e.preventDefault();
                canvasRef.current?.undo();
            } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
                e.preventDefault();
                canvasRef.current?.redo();
            } else if (key === 'a') {
                e.preventDefault();
                canvasRef.current?.autoLayout();
                handlersRef.current.showNotification(t('flowEditor.autoLayoutApplied'), 'success');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- Uses handlersRef for stable callbacks, t is stable
    }, []);

    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!canvasRef.current) return;
            const currentState = serializeWorkflowState(canvasRef.current.getWorkflow());
            if (currentState !== lastSavedStateRef.current) {
                e.preventDefault();
                e.returnValue = '';
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    if (!isAppReady) {
        return (
            <div className="flex h-screen bg-background text-foreground font-sans items-center justify-center flex-col gap-4">
                {isBootError ? (
                    <>
                        <div className="text-destructive font-mono text-sm">{loadingText}</div>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                            {t('flowEditor.retry')}
                        </button>
                    </>
                ) : (
                    <>
                        <div className="relative w-16 h-16">
                            <div className="absolute inset-0 border-4 border-border rounded-full"></div>
                            <div className="absolute inset-0 border-4 border-primary rounded-full border-t-transparent animate-spin"></div>
                        </div>
                        <div className="text-muted-foreground font-mono text-sm animate-pulse">{loadingText}</div>
                    </>
                )}
            </div>
        );
    }

    return (
        <div className="relative h-screen bg-canvas text-foreground font-sans overflow-hidden animate-in fade-in duration-500">
            {/* Hidden file input */}
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />

            {/* Canvas surface. When the agent panel is open, reserve its width so controls are not hidden behind it. */}
            <div
                className={`absolute top-0 bottom-0 left-0 transition-[right] duration-200 ${
                    isAgentOpen ? 'right-0 sm:right-80' : 'right-0'
                }`}
            >
                <WorkflowCanvas
                    ref={canvasRef}
                    flowId={currentFlowId}
                    onNodeSelect={handleSelectionChange}
                    onChange={handleCanvasChange}
                    onOpenLibrary={handleOpenLibrary}
                    onConnectionError={handleConnectionError}
                    onShowNotification={showNotification}
                    onLongformReviewApproved={handleRunWorkflow}
                />

                {/* Full Workflow Run Button */}
                <button
                    type="button"
                    onClick={() => void handleRunWorkflow()}
                    disabled={runButtonDisabled}
                    className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-floating transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    title="전체 워크플로우 실행"
                >
                    {isApplyingProposal || isWorkflowRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Play className="h-4 w-4" />
                    )}
                    <span>
                        {isApplyingProposal
                            ? '제안 배치 중'
                            : isWorkflowRunning
                              ? '실행 요청 중'
                              : runStatus === 'running'
                                ? '워크플로우 실행 중'
                                : runStatus === 'reviewing'
                                  ? '검수본으로 이어서 실행'
                                  : '워크플로우 실행'}
                    </span>
                </button>
            </div>

            {/* Floating Header */}
            <Header
                flowInfo={{
                    flowName,
                    onNameChange: handleNameChange,
                }}
                fileActions={{
                    onNew: handleNew,
                    onSave: handleSave,
                    onExport: handleExport,
                    onImport: handleImport,
                }}
                editActions={{
                    onUndo: () => canvasRef.current?.undo(),
                    onRedo: () => canvasRef.current?.redo(),
                    onAutoLayout: () => {
                        canvasRef.current?.autoLayout();
                        showNotification(t('flowEditor.autoLayoutApplied'), 'success');
                    },
                    onClear: handleClear,
                    onSave: handleSave,
                }}
                saveState={{
                    isSaving,
                    lastSavedAt,
                    isAutoSaveEnabled,
                    onToggleAutoSave: toggleAutoSave,
                    saveStatus,
                    saveError,
                    onRetrySave: retrySave,
                }}
                socketState={
                    channelId
                        ? {
                              isConnected: isSocketConnected,
                              connectionStatus: socketStatus,
                              reconnectAttempts,
                              maxReconnectReached,
                              onReconnect: socketReconnect,
                          }
                        : undefined
                }
                onShare={handleShare}
                onApiKeySettings={handleApiKeySettings}
                onHelp={() => handleOpenHelp('gettingStarted')}
                isAgentPanelOpen={isAgentOpen}
            />

            {/* Floating Sidebar */}
            <Sidebar ref={sidebarRef} onAddNode={handleAddNode} isLoading={isLoading} />

            {/* API Key Dialog */}
            <ApiKeyDialog
                open={isApiKeyDialogOpen}
                onSubmit={handleApiKeySubmit}
                onOpenChange={setIsApiKeyDialogOpen}
                codesUrl={import.meta.env.VITE_CODES_URL}
                initialValue={apiKey ?? undefined}
            />

            {/* Help Dialog */}
            <HelpDialog open={isHelpDialogOpen} onOpenChange={setIsHelpDialogOpen} defaultTab={helpDialogTab} />

            {/* Flow Agent Panel */}
            <FlowAgentPanel
                open={isAgentOpen}
                onClose={() => setIsAgentOpen(false)}
                flowId={currentFlowId}
                onApproveProposal={handleApproveProposal}
                externalProposal={latestProposal}
                runStatus={runStatus}
                runActivity={runActivity}
            />

            {/* Flow Agent Button */}
            {!isAgentOpen && (
                <button
                    onMouseDown={e => {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        agentBtnDragRef.current = {
                            mouseX: e.clientX,
                            mouseY: e.clientY,
                            btnX: rect.left,
                            btnY: rect.top,
                        };
                        agentBtnIsDraggingRef.current = false;

                        const onMouseMove = (mv: MouseEvent) => {
                            if (!agentBtnDragRef.current) return;
                            const dx = mv.clientX - agentBtnDragRef.current.mouseX;
                            const dy = mv.clientY - agentBtnDragRef.current.mouseY;
                            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                                agentBtnIsDraggingRef.current = true;
                            }
                            setAgentBtnPos({
                                x: Math.max(0, Math.min(agentBtnDragRef.current.btnX + dx, window.innerWidth - 48)),
                                y: Math.max(0, Math.min(agentBtnDragRef.current.btnY + dy, window.innerHeight - 48)),
                            });
                        };
                        const onMouseUp = () => {
                            agentBtnDragRef.current = null;
                            window.removeEventListener('mousemove', onMouseMove);
                            window.removeEventListener('mouseup', onMouseUp);
                        };
                        window.addEventListener('mousemove', onMouseMove);
                        window.addEventListener('mouseup', onMouseUp);
                    }}
                    onClick={() => {
                        if (agentBtnIsDraggingRef.current) return;
                        setIsAgentOpen(true);
                    }}
                    style={agentBtnPos ? { left: agentBtnPos.x, top: agentBtnPos.y } : undefined}
                    className={`z-30 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 cursor-grab active:cursor-grabbing select-none ${agentBtnPos ? 'fixed' : 'absolute bottom-24 right-6'}`}
                    aria-label="Flow Agent 열기"
                    title="Flow Agent"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-5 h-5"
                    >
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                </button>
            )}

            {/* Notification Toast */}
            {notification && (
                <div
                    className={`absolute top-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-in slide-in-from-top-2 fade-in z-50 backdrop-blur-sm ${
                        notification.type === 'success'
                            ? 'bg-success/90 text-success-foreground'
                            : 'bg-destructive/90 text-destructive-foreground'
                    }`}
                >
                    {notification.message}
                </div>
            )}

            {/* Loading Overlay */}
            {isLoading && (
                <div className="absolute inset-0 bg-background/50 z-50 flex items-center justify-center backdrop-blur-sm">
                    <div className="flex flex-col items-center bg-glass-bg backdrop-blur-[24px] border border-glass-border rounded-2xl p-6 shadow-floating">
                        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
                        <span className="text-sm font-medium text-foreground">{t('flowEditor.processing')}</span>
                    </div>
                </div>
            )}
        </div>
    );
};
