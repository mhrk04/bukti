type LimitKind = "check" | "publish";

type ClientState = {
  timestamps: number[];
  active: number;
};

const LIMITS: Record<LimitKind, { windowMs: number; maxRequests: number; maxActive: number; globalActive: number }> = {
  check: { windowMs: 60_000, maxRequests: 5, maxActive: 2, globalActive: 32 },
  publish: { windowMs: 60_000, maxRequests: 2, maxActive: 1, globalActive: 8 },
};

const clients = new Map<string, Record<LimitKind, ClientState>>();
const activeGlobal: Record<LimitKind, number> = { check: 0, publish: 0 };

function clientKey(request: Request): string {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    "unknown"
  );
}

/** ponytail: per-instance limiter; use a shared edge store when multi-region abuse resistance is required. */
export function acquireRequestSlot(request: Request, kind: LimitKind): { ok: true; release: () => void } | { ok: false; retryAfter: number } {
  const limit = LIMITS[kind];
  const now = Date.now();
  const key = clientKey(request);
  let state = clients.get(key);
  if (!state) {
    state = {
      check: { timestamps: [], active: 0 },
      publish: { timestamps: [], active: 0 },
    };
    clients.set(key, state);
  }

  const client = state[kind];
  client.timestamps = client.timestamps.filter((timestamp) => now - timestamp < limit.windowMs);
  const oldest = client.timestamps[0] ?? now;
  if (
    client.timestamps.length >= limit.maxRequests ||
    client.active >= limit.maxActive ||
    activeGlobal[kind] >= limit.globalActive
  ) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((limit.windowMs - (now - oldest)) / 1_000)) };
  }

  client.timestamps.push(now);
  client.active += 1;
  activeGlobal[kind] += 1;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      client.active = Math.max(0, client.active - 1);
      activeGlobal[kind] = Math.max(0, activeGlobal[kind] - 1);
    },
  };
}
