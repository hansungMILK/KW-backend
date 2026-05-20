// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFlows } from '@flows/flows';

import { FlowOpenDialog } from './FlowOpenDialog';

vi.mock('@flows/flows', () => ({
    listFlows: vi.fn(async () => [
        {
            flowId: 'flow-1',
            title: '삭제할 플로우',
            status: 'READY',
            createdAt: '2026-05-20T00:00:00.000Z',
            updatedAt: '2026-05-20T00:00:00.000Z',
        },
        {
            flowId: 'flow-2',
            title: '남길 플로우',
            status: 'DRAFT',
            createdAt: '2026-05-20T00:00:00.000Z',
            updatedAt: '2026-05-20T00:01:00.000Z',
        },
    ]),
}));

describe('FlowOpenDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    it('deletes a saved flow after confirmation and removes it from the list', async () => {
        const onDelete = vi.fn(async () => undefined);

        render(
            <FlowOpenDialog
                open
                currentFlowId={null}
                onOpenChange={() => undefined}
                onSelect={async () => undefined}
                onDelete={onDelete}
            />
        );

        expect(await screen.findByText('삭제할 플로우')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: '삭제할 플로우 삭제' }));

        await waitFor(() => {
            expect(onDelete).toHaveBeenCalledWith('flow-1');
        });
        expect(screen.queryByText('삭제할 플로우')).toBeNull();
        expect(screen.getByText('남길 플로우')).toBeTruthy();
        expect(listFlows).toHaveBeenCalledWith(30);
    });
});
