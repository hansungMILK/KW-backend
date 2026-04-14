/**
 * Shared validators for /workflows/* handlers.
 * Keep these local to this folder — they are wrapper-level concerns.
 */

/**
 * SSRF guard for user-supplied webhook URLs.
 * Rejects localhost, private IPv4 ranges, link-local (AWS metadata), file://, etc.
 */
export const isSafeWebhookUrl = (raw: string): { ok: true } | { ok: false; reason: string } => {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { ok: false, reason: 'invalid URL' };
    }

    // Only allow http/https. Block file://, gopher://, data://, etc.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { ok: false, reason: `protocol ${url.protocol} not allowed` };
    }

    let host = url.hostname.toLowerCase();

    // WHATWG URL keeps IPv6 brackets on hostname — strip them for comparisons
    if (host.startsWith('[') && host.endsWith(']')) {
        host = host.slice(1, -1);
    }

    // Strip trailing dot (e.g. "localhost.")
    if (host.endsWith('.')) host = host.slice(0, -1);

    // Block localhost by name
    if (host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.localhost')) {
        return { ok: false, reason: 'localhost not allowed' };
    }

    // Block literal loopback / any-addr
    if (host === '0.0.0.0' || host === '::' || host === '::0' || host === '::1') {
        return { ok: false, reason: 'loopback address not allowed' };
    }

    // IPv4-mapped IPv6 extraction. Accept both dotted and hex-canonical forms.
    // Node's WHATWG URL canonicalizes `::ffff:127.0.0.1` → `::ffff:7f00:1`, so regex alone misses it.
    let checkHost = host;
    const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDotted) {
        checkHost = mappedDotted[1]!;
    } else {
        const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (mappedHex) {
            const hi = parseInt(mappedHex[1]!, 16);
            const lo = parseInt(mappedHex[2]!, 16);
            const a = (hi >> 8) & 0xff;
            const b = hi & 0xff;
            const c = (lo >> 8) & 0xff;
            const d = lo & 0xff;
            checkHost = `${a}.${b}.${c}.${d}`;
        }
    }

    // Parse IPv4 and check private ranges
    const ipv4 = checkHost.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        const [a, b] = [parseInt(ipv4[1]!, 10), parseInt(ipv4[2]!, 10)];
        // 127.0.0.0/8 loopback
        if (a === 127) return { ok: false, reason: 'loopback 127/8 not allowed' };
        // 10.0.0.0/8 private
        if (a === 10) return { ok: false, reason: 'private 10/8 not allowed' };
        // 172.16.0.0/12 private
        if (a === 172 && b >= 16 && b <= 31) return { ok: false, reason: 'private 172.16/12 not allowed' };
        // 192.168.0.0/16 private
        if (a === 192 && b === 168) return { ok: false, reason: 'private 192.168/16 not allowed' };
        // 169.254.0.0/16 link-local (AWS metadata)
        if (a === 169 && b === 254) return { ok: false, reason: 'link-local 169.254/16 not allowed' };
        // 0.0.0.0/8
        if (a === 0) return { ok: false, reason: '0.0.0.0/8 not allowed' };
    }

    // IPv6 private ranges: fc00::/7 (fc/fd prefix), fe80::/10 (link-local)
    if (host.includes(':')) {
        const h = host;
        if (/^f[cd][0-9a-f]{0,2}:/.test(h)) {
            return { ok: false, reason: 'private IPv6 (fc00::/7) not allowed' };
        }
        if (/^fe[89ab][0-9a-f]?:/.test(h)) {
            return { ok: false, reason: 'link-local IPv6 (fe80::/10) not allowed' };
        }
    }

    return { ok: true };
};

/**
 * Cycle detection on a node/edge graph.
 * Returns true if the graph is a DAG (no cycles), false otherwise.
 */
export const isDag = (
    nodes: Array<{ id: string }>,
    edges: Array<{ source: string; target: string }>
): boolean => {
    if (nodes.length === 0) return true;

    const nodeIds = new Set(nodes.map(n => n.id));
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const n of nodes) {
        adj.set(n.id, []);
        inDegree.set(n.id, 0);
    }
    for (const e of edges) {
        if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue; // ignore dangling edges
        adj.get(e.source)!.push(e.target);
        inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
        const u = queue.shift()!;
        visited++;
        for (const v of adj.get(u) ?? []) {
            const d = (inDegree.get(v) ?? 0) - 1;
            inDegree.set(v, d);
            if (d === 0) queue.push(v);
        }
    }

    return visited === nodes.length;
};
