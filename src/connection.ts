import { applyDelta, mergeEvents, type DynamicWorld, type StaticWorld, type WorldState } from './world';

export type ConnectionStatus = 'loading' | 'live' | 'reconnecting' | 'error';
const observer = 'https://www.midnight.city/observer';

async function publicJson(path: string, signal: AbortSignal) {
  const response = await fetch(`${observer}${path}`, { credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
  if (!response.ok) throw new Error(`Midnight City returned ${response.status}.`);
  return response.json();
}

function validateDynamic(world: DynamicWorld) {
  if (!Array.isArray(world?.agents) || !Number.isFinite(world.tick) || world.agents.some(agent => !agent.id || !agent.name || !agent.position || !Number.isFinite(agent.position.x) || !Number.isFinite(agent.position.y))) {
    throw new Error('Midnight City sent an unsupported world snapshot.');
  }
}

export function connectWorld(onWorld: (world: WorldState) => void, onStatus: (status: ConnectionStatus, message?: string) => void) {
  const abort = new AbortController();
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let state: WorldState | undefined;
  let generation = 0;
  let stopped = false;
  let lastFrameAt = Date.now();

  function schedule(message: string) {
    if (stopped || retry) return;
    onStatus(state ? 'reconnecting' : 'error', message);
    const delay = Math.min(30000, 1500 * 2 ** Math.min(attempts++, 5));
    retry = setTimeout(() => { retry = undefined; void start(); }, delay);
  }

  async function start() {
    const currentGeneration = ++generation;
    socket?.close();
    try {
      const bootstrap = await publicJson('/api/spectator/bootstrap', abort.signal);
      validateDynamic(bootstrap.dynamicWorld);
      let staticWorld = state && state.staticVersion === bootstrap.staticVersion ? state.staticWorld : undefined;
      let agentSeeds = state?.agentSeeds;
      if (!staticWorld) {
        const response = await publicJson(`/api/static-world/${encodeURIComponent(bootstrap.staticVersion)}`, abort.signal);
        staticWorld = response.staticWorld as StaticWorld;
        agentSeeds = response.agentSeeds;
        if (!Array.isArray(staticWorld?.spaces) || !staticWorld.cells || !Array.isArray(staticWorld.areas) || !Array.isArray(staticWorld.teleports) || response.staticVersion !== bootstrap.staticVersion) throw new Error('The city map changed while loading. Reconnecting.');
      }
      if (stopped || generation !== currentGeneration) return;
      state = { staticWorld, agentSeeds, dynamicWorld: bootstrap.dynamicWorld, staticVersion: bootstrap.staticVersion,
        sequence: bootstrap.sequence, events: mergeEvents(state?.events ?? [], bootstrap.recentEvents ?? []), receivedAt: Date.now() };
      onWorld(state);
      onStatus('reconnecting', 'Connecting to the live city…');
      const query = new URLSearchParams({ staticVersion: state.staticVersion, sequence: String(state.sequence) });
      const connection = new WebSocket(`wss://www.midnight.city/observer/ws?${query}`);
      socket = connection;
      lastFrameAt = Date.now();
      connection.onmessage = event => {
        if (stopped || generation !== currentGeneration || !state) return;
        try {
          const message = JSON.parse(event.data);
          if (message.staticVersion !== state.staticVersion) throw new Error('The city map has updated.');
          if (message.type === 'snapshot') {
            validateDynamic(message.dynamicWorld);
            state = { ...state, dynamicWorld: message.dynamicWorld, sequence: message.sequence, receivedAt: Date.now() };
          } else if (message.type === 'spectator_delta' || message.type === 'delta') {
            if (message.toSequence <= state.sequence) return;
            state = applyDelta(state, message);
          } else return;
          lastFrameAt = Date.now();
          attempts = 0;
          onStatus('live');
          onWorld(state);
        } catch (error) {
          connection.close();
          schedule(error instanceof Error ? error.message : 'Refreshing the live city.');
        }
      };
      connection.onclose = () => { if (currentGeneration === generation) schedule('The live connection dropped. Reconnecting…'); };
      connection.onerror = () => connection.close();
    } catch (error) {
      if (!stopped) schedule(error instanceof Error ? error.message : 'Could not reach Midnight City.');
    }
  }
  const health = setInterval(() => {
    if (socket && Date.now() - lastFrameAt > 15000) { socket.close(); schedule('The city feed is stale. Reconnecting…'); }
  }, 5000);
  void start();
  return () => { stopped = true; generation++; abort.abort(); clearInterval(health); clearTimeout(retry); socket?.close(); };
}
