import { useCallback, useEffect, useState } from 'react';

import { FolderOpen, Loader2, RefreshCw } from 'lucide-react';

import { listFlows } from '@flows/flows';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@flows/ui-kit';

interface FlowOpenDialogProps {
    open: boolean;
    currentFlowId: string | null;
    onOpenChange: (open: boolean) => void;
    onSelect: (flowId: string) => Promise<void>;
}

type FlowSummary = Awaited<ReturnType<typeof listFlows>>[number];

const formatDate = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
};

export const FlowOpenDialog = ({ open, currentFlowId, onOpenChange, onSelect }: FlowOpenDialogProps) => {
    const [flows, setFlows] = useState<FlowSummary[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [openingId, setOpeningId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            setFlows(await listFlows(30));
        } catch (err) {
            setError(err instanceof Error ? err.message : '저장한 플로우 목록을 불러오지 못했습니다.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) void load();
    }, [load, open]);

    const handleSelect = async (flowId: string) => {
        setOpeningId(flowId);
        setError(null);
        try {
            await onSelect(flowId);
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : '플로우를 열지 못했습니다.');
        } finally {
            setOpeningId(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[92vw] max-w-xl p-5 max-h-[86vh] overflow-y-auto">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <FolderOpen className="w-4 h-4 text-primary" />
                        저장한 플로우 열기
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        백엔드에 저장된 플로우를 최신 수정순으로 불러옵니다.
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-4 flex justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={load}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        새로고침
                    </Button>
                </div>

                <div className="mt-3 space-y-2">
                    {!isLoading && flows.length === 0 && (
                        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                            저장된 플로우가 없습니다.
                        </div>
                    )}
                    {flows.map(flow => {
                        const isCurrent = flow.flowId === currentFlowId;
                        const isOpening = openingId === flow.flowId;

                        return (
                            <section
                                key={flow.flowId}
                                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="truncate text-sm font-semibold text-foreground">{flow.title}</h3>
                                        {isCurrent && (
                                            <Badge variant="blue" size="sm">
                                                현재
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        {flow.status} · {formatDate(flow.updatedAt)}
                                    </div>
                                    <code className="mt-1 block truncate text-[11px] text-muted-foreground">
                                        {flow.flowId}
                                    </code>
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 shrink-0 text-xs"
                                    disabled={isCurrent || Boolean(openingId)}
                                    onClick={() => handleSelect(flow.flowId)}
                                >
                                    {isOpening && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    열기
                                </Button>
                            </section>
                        );
                    })}
                </div>

                {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            </DialogContent>
        </Dialog>
    );
};
