import { useCallback, useEffect, useState } from 'react';

import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Trash2 } from 'lucide-react';

import { deleteProviderApiKey, listProviderApiKeys, saveProviderApiKey, verifyProviderApiKey } from '@flows/flows';
import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    Input,
} from '@flows/ui-kit';

interface ProviderCredentialsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type ApiKeyInfo = Awaited<ReturnType<typeof listProviderApiKeys>>[number];
type ApiKeyProvider = ApiKeyInfo['provider'];

const PROVIDERS: ApiKeyProvider[] = ['openai', 'elevenlabs', 'anthropic', 'nanobanana'];

const PROVIDER_LABEL: Record<ApiKeyProvider, string> = {
    anthropic: 'Anthropic',
    elevenlabs: 'ElevenLabs',
    nanobanana: 'Nano Banana',
    openai: 'OpenAI',
};

const PROVIDER_HINT: Record<ApiKeyProvider, string> = {
    anthropic: 'Claude 기반 분석/글 생성에 사용',
    elevenlabs: '나레이션 TTS MP3 생성에 사용',
    nanobanana: 'Nano Banana 이미지 생성에 사용',
    openai: '오케스트레이터, 대본, 이미지 생성에 사용',
};

const emptyDrafts = (): Record<ApiKeyProvider, string> => ({
    anthropic: '',
    elevenlabs: '',
    nanobanana: '',
    openai: '',
});

const getStatusVariant = (status: ApiKeyInfo['status']): 'green' | 'orange' | 'destructive' | 'default' => {
    if (status === 'active') return 'green';
    if (status === 'invalid') return 'destructive';
    if (status === 'unverified') return 'orange';
    return 'default';
};

export const ProviderCredentialsDialog = ({ open, onOpenChange }: ProviderCredentialsDialogProps) => {
    const [items, setItems] = useState<ApiKeyInfo[]>([]);
    const [drafts, setDrafts] = useState<Record<ApiKeyProvider, string>>(emptyDrafts);
    const [showKeys, setShowKeys] = useState<Record<ApiKeyProvider, boolean>>({
        anthropic: false,
        elevenlabs: false,
        nanobanana: false,
        openai: false,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            setItems(await listProviderApiKeys());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Provider API 키 목록을 불러오지 못했습니다.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        setMessage(null);
        setError(null);
        setDrafts(emptyDrafts());
        void load();
    }, [load, open]);

    const byProvider = new Map(items.map(item => [item.provider, item]));

    const handleSave = async (provider: ApiKeyProvider) => {
        const apiKey = drafts[provider].trim();
        if (!apiKey) return;
        setBusy(`${provider}:save`);
        setError(null);
        setMessage(null);
        try {
            await saveProviderApiKey(provider, apiKey);
            setDrafts(current => ({ ...current, [provider]: '' }));
            setMessage(`${PROVIDER_LABEL[provider]} 키를 저장했습니다.`);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : `${PROVIDER_LABEL[provider]} 키 저장에 실패했습니다.`);
        } finally {
            setBusy(null);
        }
    };

    const handleVerify = async (provider: ApiKeyProvider) => {
        setBusy(`${provider}:verify`);
        setError(null);
        setMessage(null);
        try {
            const result = await verifyProviderApiKey(provider);
            setMessage(
                result.valid
                    ? `${PROVIDER_LABEL[provider]} 키 검증이 완료됐습니다.`
                    : `${PROVIDER_LABEL[provider]} 키 검증 실패: ${result.message ?? result.status}`
            );
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : `${PROVIDER_LABEL[provider]} 키 검증에 실패했습니다.`);
        } finally {
            setBusy(null);
        }
    };

    const handleDelete = async (provider: ApiKeyProvider) => {
        if (!window.confirm(`${PROVIDER_LABEL[provider]} 키를 삭제할까요?`)) return;
        setBusy(`${provider}:delete`);
        setError(null);
        setMessage(null);
        try {
            await deleteProviderApiKey(provider);
            setMessage(`${PROVIDER_LABEL[provider]} 키를 삭제했습니다.`);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : `${PROVIDER_LABEL[provider]} 키 삭제에 실패했습니다.`);
        } finally {
            setBusy(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[92vw] max-w-2xl p-5 max-h-[86vh] overflow-y-auto">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <KeyRound className="w-4 h-4 text-primary" />
                        Provider API 키 설정
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        OpenAI, ElevenLabs 같은 외부 생성 비용은 여기에 저장한 키로 실행됩니다. 저장된 원문 키는 다시
                        표시하지 않습니다.
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-3">
                    {PROVIDERS.map(provider => {
                        const item = byProvider.get(provider);
                        const configured = item?.configured ?? false;
                        const isProviderBusy = busy?.startsWith(`${provider}:`) ?? false;

                        return (
                            <section
                                key={provider}
                                className="rounded-lg border border-border bg-muted/20 p-3 space-y-3"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-sm font-semibold text-foreground">
                                                {PROVIDER_LABEL[provider]}
                                            </h3>
                                            <Badge variant={getStatusVariant(item?.status ?? 'missing')} size="sm">
                                                {item?.status ?? 'missing'}
                                            </Badge>
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">{PROVIDER_HINT[provider]}</p>
                                    </div>
                                    {configured && item?.maskedKey && (
                                        <div className="text-right">
                                            <div className="text-[11px] text-muted-foreground">저장됨</div>
                                            <code className="text-xs text-foreground">{item.maskedKey}</code>
                                        </div>
                                    )}
                                </div>

                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <div className="relative flex-1">
                                        <Input
                                            type={showKeys[provider] ? 'text' : 'password'}
                                            value={drafts[provider]}
                                            onChange={event =>
                                                setDrafts(current => ({ ...current, [provider]: event.target.value }))
                                            }
                                            placeholder={`${PROVIDER_LABEL[provider]} API key`}
                                            className="h-9 pr-9 text-sm"
                                            disabled={isProviderBusy}
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setShowKeys(current => ({ ...current, [provider]: !current[provider] }))
                                            }
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showKeys[provider] ? (
                                                <EyeOff className="w-4 h-4" />
                                            ) : (
                                                <Eye className="w-4 h-4" />
                                            )}
                                        </button>
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="h-9 text-xs"
                                        disabled={!drafts[provider].trim() || isProviderBusy}
                                        onClick={() => handleSave(provider)}
                                    >
                                        {busy === `${provider}:save` && (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        )}
                                        저장
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-9 text-xs"
                                        disabled={!configured || isProviderBusy}
                                        onClick={() => handleVerify(provider)}
                                    >
                                        {busy === `${provider}:verify` ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                        )}
                                        검증
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-9 text-xs text-destructive hover:text-destructive"
                                        disabled={!configured || isProviderBusy}
                                        onClick={() => handleDelete(provider)}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        삭제
                                    </Button>
                                </div>
                            </section>
                        );
                    })}
                </div>

                {isLoading && <p className="mt-3 text-xs text-muted-foreground">Provider 상태를 불러오는 중...</p>}
                {message && <p className="mt-3 text-xs text-success">{message}</p>}
                {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            </DialogContent>
        </Dialog>
    );
};
