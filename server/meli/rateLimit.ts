interface Waiter { resolve: (release: () => void) => void }
interface LimiterState {
  active: number;
  limit: number;
  maxLimit: number;
  successStreak: number;
  cooldownUntil: number;
  queue: Waiter[];
  wakeTimer: NodeJS.Timeout | null;
}

const states = new Map<string, LimiterState>();
const DEFAULT_LIMIT = 4;

function stateFor(key: string): LimiterState {
  let state = states.get(key);
  if (!state) {
    const maxLimit = key === '__application__' ? 12 : DEFAULT_LIMIT;
    state = { active: 0, limit: maxLimit, maxLimit, successStreak: 0, cooldownUntil: 0, queue: [], wakeTimer: null };
    states.set(key, state);
  }
  return state;
}

function drain(key: string): void {
  const state = stateFor(key);
  if (state.cooldownUntil > Date.now()) {
    if (!state.wakeTimer) {
      const delay = Math.min(60_000, state.cooldownUntil - Date.now());
      state.wakeTimer = setTimeout(() => {
        state.wakeTimer = null;
        drain(key);
      }, Math.max(50, delay));
      state.wakeTimer.unref?.();
    }
    return;
  }
  while (state.active < state.limit && state.queue.length) {
    const waiter = state.queue.shift()!;
    state.active += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      drain(key);
    });
  }
}

export function acquireMeliSlot(key: string): Promise<() => void> {
  return new Promise((resolve) => {
    stateFor(key).queue.push({ resolve });
    drain(key);
  });
}

export function reportMeliResponse(key: string, status: number, retryAfterMs = 0): void {
  const state = stateFor(key);
  if (status === 429) {
    state.limit = Math.max(1, Math.floor(state.limit / 2));
    state.successStreak = 0;
    state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + Math.max(1_000, retryAfterMs));
  } else if (status >= 200 && status < 400) {
    state.successStreak += 1;
    if (state.successStreak >= 20 && state.limit < state.maxLimit) {
      state.limit += 1;
      state.successStreak = 0;
    }
  }
  drain(key);
}

export function meliLimiterSnapshot(key: string): { active: number; limit: number; queued: number; cooldownUntil: number } {
  const state = stateFor(key);
  return { active: state.active, limit: state.limit, queued: state.queue.length, cooldownUntil: state.cooldownUntil };
}
