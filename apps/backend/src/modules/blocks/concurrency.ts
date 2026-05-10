export async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>,
    options?: { shouldStop?: () => boolean }
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let nextIndex = 0;

    const runNext = async (): Promise<void> => {
        while (nextIndex < items.length) {
            if (options?.shouldStop?.()) break;
            const currentIndex = nextIndex;
            nextIndex += 1;
            try {
                results[currentIndex] = { status: 'fulfilled', value: await worker(items[currentIndex]) };
            } catch (reason) {
                results[currentIndex] = { status: 'rejected', reason };
            }
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
    return results;
}
