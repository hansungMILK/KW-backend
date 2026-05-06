import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Play } from 'lucide-react';

import {
    EXECUTE_FUNCTIONS,
    createFlowRun,
    getNode,
    getPortData,
    getRun,
    getRunAssets,
    getRunNodes,
    useBlocks,
    useCanvasStore,
    useFlows,
} from '@flows/flows';
import { ApiKeyDialog } from '@flows/shared';
import { useInitFlowSocket } from '@flows/socket';
import { extractErrorMessage, useWebCoreStore } from '@flows/web-core';

// [추가] Flow Agent 채팅 패널 컴포넌트 import
// - 원본에는 없던 컴포넌트로, 우측에 열리는 AI 채팅 패널을 담당합니다.
import { AssetPreviewPanel } from '../components/AssetPreviewPanel';
import { FlowAgentPanel } from '../components/FlowAgentPanel';
import { Header } from '../components/Header';
import { HelpDialog } from '../components/HelpDialog';
import { Sidebar } from '../components/Sidebar';
import { WorkflowCanvas } from '../components/WorkflowCanvas';

import type { HelpTab } from '../components/help';
import type { SidebarRef } from '../components/Sidebar';
import type { WorkflowCanvasRef } from '../components/WorkflowCanvas';
import type { RunGetResponse, RunNode } from '@flows/contracts';
import type { AssetCreatedMessage, NodeUpdateInfo, PortUpdateInfo, ProposalCreatedMessage } from '@flows/socket';

const serializeWorkflowState = (data: { nodes?: unknown[]; connections?: unknown[]; edges?: unknown[] }): string =>
    JSON.stringify({ nodes: data.nodes ?? [], connections: data.connections ?? data.edges ?? [] });

const isInputElement = (target: EventTarget | null): boolean => {
    if (!target || !(target instanceof HTMLElement)) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
};

type RunActivity = {
    nodeId?: string;
    nodeLabel?: string;
    progress?: number;
    state?: 'queued' | 'running' | 'completed' | 'failed';
    error?: string | null;
};

const RUN_POLL_INTERVAL_MS = 2000;
const RUN_POLL_TIMEOUT_MS = 15 * 60 * 1000;

const delay = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

const toCanvasNodeState = (status: RunNode['status']) => {
    if (status === 'RUNNING') return 'RUNNING';
    if (status === 'COMPLETED') return 'COMPLETED';
    if (status === 'FAILED') return 'ERROR';
    return undefined;
};

const toVisibleRunError = (message?: string | null): string | null => {
    if (!message) return null;
    const rawIndex = message.indexOf(' Raw:');
    const trimmed = (rawIndex === -1 ? message : message.slice(0, rawIndex)).trim();
    return trimmed.length > 260 ? `${trimmed.slice(0, 257)}...` : trimmed;
};

const getFinalSummaryValue = (run: RunGetResponse, key: string): string | null => {
    const value = run.finalOutputSummary?.[key];
    return typeof value === 'string' ? value : null;
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

    // Handle flow update notification from WebSocket (new format)
    // Fetches entire flow from server and updates canvas
    const handleFlowUpdate = useCallback(
        async (flowId: string) => {
            try {
                const flowData = await loadFlowById(flowId);
                if (canvasRef.current && flowData) {
                    await canvasRef.current.loadWorkflow(flowData);
                    setCanvasNodeCount(flowData.nodes?.length ?? 0);
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
            const { nodeId, flowId, isPort, parentNodeId, state, progress, no, errorMessage } = info;

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

            const currentWorkflow = canvasRef.current.getWorkflow();
            const currentNode = currentWorkflow?.nodes?.find(n => n.id === nodeId);
            const nodeLabel =
                (currentNode as { customLabel?: string } | undefined)?.customLabel ??
                currentNode?.name ??
                (currentNode?.type ? blockRegistry[currentNode.type]?.label : undefined) ??
                nodeId;

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

            // ERROR state: prefer run-node error from WebSocket, then fall back to node fetch.
            if (state === 'ERROR') {
                const visibleError = toVisibleRunError(errorMessage) ?? '노드 실행 실패';
                setRunActivity({
                    nodeId,
                    nodeLabel,
                    progress,
                    state: 'failed',
                    error: visibleError,
                });
                if (errorMessage) {
                    canvasRef.current.updateNodeFromServer(nodeId, {
                        state,
                        status: state,
                        errorMessage: visibleError,
                    });
                    return;
                }
                try {
                    const nodeData = await getNode(nodeId);
                    canvasRef.current.updateNodeFromServer(nodeId, {
                        state,
                        status: state,
                        errorMessage: nodeData.errorMessage,
                    });
                } catch {
                    // Fallback: update state without errorMessage if API fails
                    canvasRef.current.updateNodeFromServer(nodeId, {
                        state,
                        status: state,
                    });
                }
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
                setRunActivity({
                    nodeId,
                    nodeLabel,
                    progress: progress ?? 0,
                    state: 'running',
                });
            } else if (state === 'COMPLETED') {
                setRunActivity(prev =>
                    prev?.nodeId === nodeId
                        ? {
                              nodeId,
                              nodeLabel,
                              progress: 100,
                              state: 'completed',
                          }
                        : prev
                );
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
        [blockRegistry, currentFlowId]
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
            const { portId, nodeId, flowId, portName, no } = info;

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

            const isOutputPort = portName === 'out';

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

            const direction = isOutputPort ? 'out' : 'in';

            try {
                const portData = await getPortData(portId, direction);

                if (portData?.data) {
                    const dataPacket = {
                        value: portData.data.value,
                        type: portData.data.type,
                        timestamp: portData.data.timestamp,
                    };

                    const portKey = portData.portId || portName || direction;

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
        onProposalCreated: msg => {
            setLatestProposal(msg);
            setIsAgentOpen(true);
        },
        onRunStarted: () => {
            setRunStatus('running');
            setRunFailedError(null);
            setRunActivity({ nodeLabel: '실행 준비 중', progress: 0, state: 'queued' });
            if (runStatusTimerRef.current) window.clearTimeout(runStatusTimerRef.current);
        },
        onRunCompleted: () => {
            setRunStatus('completed');
            setRunActivity({ nodeLabel: '전체 실행 완료', progress: 100, state: 'completed' });
            runStatusTimerRef.current = window.setTimeout(() => {
                setRunStatus(null);
                setRunActivity(null);
            }, 4000);
        },
        onRunFailed: msg => {
            setRunStatus('failed');
            setRunFailedError(msg.error ?? null);
            setRunActivity({
                nodeId: msg.failedNodeId,
                nodeLabel: msg.failedNodeId ? `노드 ${msg.failedNodeId}` : '실행 실패',
                state: 'failed',
                error: msg.error ?? null,
            });
            if (msg.failedNodeId) {
                canvasRef.current?.updateNodeFromServer(msg.failedNodeId, { status: 'ERROR' });
            }
        },
        onAssetCreated: msg => setLatestAsset(msg),
    });

    const [isAppReady, setIsAppReady] = useState(false);
    const [loadingText, setLoadingText] = useState('');
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
    const [isHelpDialogOpen, setIsHelpDialogOpen] = useState(false);
    // [추가] Flow Agent 패널 열림/닫힘 상태
    // - true: 우측에 채팅 패널이 열림
    // - false: 패널이 닫히고 우측 하단에 채팅 버튼이 표시됨
    const [isAgentOpen, setIsAgentOpen] = useState(false);
    const [latestProposal, setLatestProposal] = useState<ProposalCreatedMessage | null>(null);
    const [runStatus, setRunStatus] = useState<'running' | 'completed' | 'failed' | null>(null);
    const [runFailedError, setRunFailedError] = useState<string | null>(null);
    const [runActivity, setRunActivity] = useState<RunActivity | null>(null);
    const [canvasNodeCount, setCanvasNodeCount] = useState(0);
    const [latestAsset, setLatestAsset] = useState<AssetCreatedMessage | null>(null);
    const runStatusTimerRef = useRef<number | null>(null);
    const runPollTokenRef = useRef(0);
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

                setIsAppReady(true);

                // Wait for canvas to mount after render
                const waitForCanvas = async () => {
                    if (canvasRef.current) {
                        if (initialFlow) {
                            try {
                                await canvasRef.current.loadWorkflow(initialFlow);
                                setCanvasNodeCount(initialFlow.nodes?.length ?? 0);
                                lastSavedStateRef.current = serializeWorkflowState(initialFlow);
                            } catch (error) {
                                console.error('[FlowEditor] Failed to load workflow:', error);
                            }
                        }
                        if (loadedId) {
                            updateUrl(loadedId, nodeIdFromHash);
                        }
                        if (nodeIdFromHash) {
                            canvasRef.current.selectNode(nodeIdFromHash);
                        }
                    } else {
                        // Canvas not ready yet, retry
                        requestAnimationFrame(waitForCanvas);
                    }
                };
                requestAnimationFrame(waitForCanvas);
            } catch (e) {
                setLoadingText(t('flowEditor.errorLoadingApp'));
                console.error(e);
            }
        };

        boot();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- Boot runs once on mount, dependencies are stable singletons
    }, []);

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
            setCanvasNodeCount(0);
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
            setCanvasNodeCount(0);
            showNotification(t('flowEditor.canvasCleared'), 'success');
        }
    };

    const handleAddNode = useCallback((type: string, customLabel?: string) => {
        canvasRef.current?.addNode(type, customLabel);
    }, []);

    const handleApproveProposal = useCallback(
        async (nodes: unknown[], edges: unknown[]) => {
            if (!canvasRef.current || (!nodes.length && !edges.length)) return;
            try {
                await canvasRef.current.loadWorkflow({ nodes, edges } as Parameters<
                    WorkflowCanvasRef['loadWorkflow']
                >[0]);
                setCanvasNodeCount(nodes.length);
                lastSavedStateRef.current = null;
                showNotification('캔버스에 블록이 배치되었습니다.', 'success');
                triggerAutoSave();
            } catch {
                showNotification('캔버스 업데이트 실패', 'error');
            }
        },
        [triggerAutoSave]
    );

    const handleSelectionChange = (nodeId: string | null) => {
        updateUrl(currentFlowId, nodeId);
    };

    const handleCanvasChange = () => {
        lastLocalUpdateTimestampRef.current = Date.now(); // Mark change time to ignore self-echo from socket
        setCanvasNodeCount(canvasRef.current?.getWorkflow().nodes.length ?? 0);
        triggerAutoSave();
    };

    const applyRunNodeSnapshots = useCallback((runNodes: RunNode[]) => {
        let runningNode: RunNode | undefined;
        let failedNode: RunNode | undefined;

        for (const runNode of runNodes) {
            const canvasState = toCanvasNodeState(runNode.status);
            if (canvasState) {
                canvasRef.current?.updateNodeFromServer(runNode.nodeId, {
                    state: canvasState,
                    status: canvasState,
                    errorMessage: toVisibleRunError(runNode.errorMessage) ?? undefined,
                    executionStats: {
                        progress: runNode.progress,
                    },
                });
            }

            if (runNode.status === 'RUNNING') runningNode = runNode;
            if (runNode.status === 'FAILED') failedNode = runNode;
        }

        if (failedNode) {
            setRunActivity({
                nodeId: failedNode.nodeId,
                nodeLabel: failedNode.label,
                progress: failedNode.progress,
                state: 'failed',
                error: toVisibleRunError(failedNode.errorMessage) ?? '노드 실행 실패',
            });
            return;
        }

        if (runningNode) {
            setRunActivity({
                nodeId: runningNode.nodeId,
                nodeLabel: runningNode.label,
                progress: runningNode.progress,
                state: 'running',
            });
        }
    }, []);

    const showLatestRunAsset = useCallback(
        async (runId: string) => {
            const assets = await getRunAssets(runId);
            const asset = assets.find(item => item.type === 'video') ?? assets[assets.length - 1];
            if (!asset) return;

            setLatestAsset({
                type: 'asset.created',
                id: asset.id,
                flowId: currentFlowId ?? undefined,
                assetId: asset.id,
                assetType: asset.type,
                url: asset.url,
                publicUrl: asset.url,
                timestamp: Date.now(),
            });
        },
        [currentFlowId]
    );

    const handleStartFlowRun = useCallback(async () => {
        if (!currentFlowId) {
            showNotification('실행할 Flow가 없습니다.', 'error');
            return;
        }

        const nodeCount = canvasRef.current?.getWorkflow().nodes.length ?? canvasNodeCount;
        if (nodeCount === 0) {
            showNotification('먼저 블록을 생성하거나 승인해주세요.', 'error');
            return;
        }

        setIsAgentOpen(true);
        setRunStatus('running');
        setRunFailedError(null);
        setRunActivity({ nodeLabel: '실행 요청 전송 중', progress: 0, state: 'queued' });
        if (runStatusTimerRef.current) window.clearTimeout(runStatusTimerRef.current);
        const pollToken = runPollTokenRef.current + 1;
        runPollTokenRef.current = pollToken;

        try {
            const run = await createFlowRun(currentFlowId);
            if (run.status === 'COMPLETED') {
                setRunStatus('completed');
                setRunActivity({ nodeLabel: '전체 실행 완료', progress: 100, state: 'completed' });
                await showLatestRunAsset(run.id);
                runStatusTimerRef.current = window.setTimeout(() => {
                    setRunStatus(null);
                    setRunActivity(null);
                }, 4000);
                return;
            }

            if (run.status === 'FAILED') {
                setRunStatus('failed');
                setRunFailedError('Run failed');
                setRunActivity({ nodeLabel: '실행 실패', state: 'failed', error: 'Run failed' });
                await showLatestRunAsset(run.id);
                return;
            }

            setRunActivity({ nodeLabel: 'Worker 대기 중', progress: 0, state: 'queued' });

            const startedAt = Date.now();
            while (runPollTokenRef.current === pollToken && Date.now() - startedAt < RUN_POLL_TIMEOUT_MS) {
                await delay(RUN_POLL_INTERVAL_MS);
                if (runPollTokenRef.current !== pollToken) return;

                const [runDetail, runNodes] = await Promise.all([getRun(run.id), getRunNodes(run.id)]);
                applyRunNodeSnapshots(runNodes);

                if (runDetail.status === 'COMPLETED') {
                    setRunStatus('completed');
                    setRunFailedError(null);
                    setRunActivity({ nodeLabel: '전체 실행 완료', progress: 100, state: 'completed' });
                    await showLatestRunAsset(run.id);
                    runStatusTimerRef.current = window.setTimeout(() => {
                        setRunStatus(null);
                        setRunActivity(null);
                    }, 4000);
                    return;
                }

                if (runDetail.status === 'FAILED') {
                    const failedNodeId = getFinalSummaryValue(runDetail, 'failedNodeId');
                    const failedNode = runNodes.find(node => node.nodeId === failedNodeId || node.status === 'FAILED');
                    const message =
                        toVisibleRunError(failedNode?.errorMessage) ??
                        toVisibleRunError(getFinalSummaryValue(runDetail, 'errorMessage')) ??
                        '워크플로우 실행 실패';

                    setRunStatus('failed');
                    setRunFailedError(message);
                    setRunActivity({
                        nodeId: failedNode?.nodeId ?? failedNodeId ?? undefined,
                        nodeLabel: failedNode?.label ?? (failedNodeId ? `노드 ${failedNodeId}` : '실행 실패'),
                        progress: failedNode?.progress,
                        state: 'failed',
                        error: message,
                    });
                    if (failedNode?.nodeId) {
                        canvasRef.current?.updateNodeFromServer(failedNode.nodeId, {
                            state: 'ERROR',
                            status: 'ERROR',
                            errorMessage: message,
                        });
                    }
                    await showLatestRunAsset(run.id);
                    showNotification(message, 'error');
                    return;
                }

                if (runDetail.status === 'CANCELLED') {
                    setRunStatus('failed');
                    setRunFailedError('실행이 취소되었습니다.');
                    setRunActivity({ nodeLabel: '실행 취소', state: 'failed', error: '실행이 취소되었습니다.' });
                    return;
                }
            }

            setRunActivity({
                nodeLabel: '실행 중 - 상태 확인 계속 필요',
                progress: 0,
                state: 'running',
            });
        } catch (error) {
            const message = extractErrorMessage(error);
            setRunStatus('failed');
            setRunFailedError(message);
            setRunActivity({ nodeLabel: '실행 시작 실패', state: 'failed', error: message });
            showNotification(message, 'error');
        }
    }, [applyRunNodeSnapshots, canvasNodeCount, currentFlowId, showLatestRunAsset]);

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
                <div className="relative w-16 h-16">
                    <div className="absolute inset-0 border-4 border-border rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-primary rounded-full border-t-transparent animate-spin-slow"></div>
                </div>
                <div className="text-muted-foreground font-mono text-sm animate-pulse">{loadingText}</div>
            </div>
        );
    }

    return (
        <div className="relative h-screen bg-canvas text-foreground font-sans overflow-hidden animate-in fade-in duration-500">
            {/* Hidden file input */}
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />

            {/* Full-screen Canvas */}
            <div className="absolute inset-0">
                <WorkflowCanvas
                    ref={canvasRef}
                    flowId={currentFlowId}
                    onNodeSelect={handleSelectionChange}
                    onChange={handleCanvasChange}
                    onOpenLibrary={handleOpenLibrary}
                    onConnectionError={handleConnectionError}
                    onShowNotification={showNotification}
                />
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

            {/*
             * [추가] Flow Agent 채팅 패널
             * - isAgentOpen이 true일 때 화면 우측에 채팅 패널이 열립니다.
             * - open: 패널 열림 여부 전달
             * - onClose: X 버튼 클릭 시 패널을 닫는 함수 전달
             */}
            <FlowAgentPanel
                open={isAgentOpen}
                onClose={() => setIsAgentOpen(false)}
                flowId={currentFlowId}
                onApproveProposal={handleApproveProposal}
                externalProposal={latestProposal}
                runStatus={runStatus}
                runActivity={runActivity}
            />

            {/*
             * [추가] Flow Agent 실행 버튼 (채팅 버튼)
             * - 패널이 닫혀 있을 때(!isAgentOpen)만 화면 우측 하단에 표시됩니다.
             * - 클릭하면 isAgentOpen을 true로 바꿔 패널을 엽니다.
             * - 패널이 열리면 이 버튼은 자동으로 사라집니다(중복 방지).
             */}
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
                    className={`z-30 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 cursor-grab active:cursor-grabbing select-none ${agentBtnPos ? 'fixed' : 'absolute bottom-6 right-6'}`}
                    title="Flow Agent"
                >
                    {/* 말풍선 아이콘 (lucide-react에 없어서 SVG 직접 사용) */}
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

            {canvasNodeCount > 0 && (
                <button
                    onClick={() => void handleStartFlowRun()}
                    disabled={runStatus === 'running'}
                    className="absolute bottom-8 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-primary/35 bg-background/85 px-5 py-2.5 text-sm font-semibold text-foreground shadow-floating backdrop-blur-xl transition-colors hover:border-primary/60 hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                    title="워크플로우 실행"
                    aria-label="워크플로우 실행"
                >
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <Play className="h-3.5 w-3.5 fill-current" />
                    </span>
                    워크플로우 실행
                </button>
            )}

            {/* Run status banner */}
            {runStatus && (
                <div
                    className={`absolute top-16 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-in slide-in-from-top-2 fade-in z-50 backdrop-blur-sm ${
                        runStatus === 'running'
                            ? 'bg-status-running/20 text-status-running border border-status-running/30'
                            : runStatus === 'completed'
                              ? 'bg-status-completed/20 text-status-completed border border-status-completed/30'
                              : 'bg-destructive/20 text-destructive border border-destructive/30'
                    }`}
                >
                    {runStatus === 'running' && (
                        <span className="w-2 h-2 rounded-full bg-status-running animate-pulse" />
                    )}
                    {runStatus === 'running' && '실행 중...'}
                    {runStatus === 'completed' && '✓ 실행 완료'}
                    {runStatus === 'failed' && `실행 실패${runFailedError ? `: ${runFailedError}` : ''}`}
                    {runStatus !== 'running' && (
                        <button
                            onClick={() => setRunStatus(null)}
                            className="ml-1 opacity-60 hover:opacity-100 transition-opacity text-xs"
                        >
                            ✕
                        </button>
                    )}
                </div>
            )}

            {/* Asset preview panel */}
            {latestAsset && <AssetPreviewPanel asset={latestAsset} onClose={() => setLatestAsset(null)} />}

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
