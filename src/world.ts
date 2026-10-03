export interface Position { spaceId: string; x: number; y: number }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface Space { id: string; name: string; kind: string; width: number; height: number; entry: Position }
export interface Area { id: string; name: string; kind: string; spaceId: string; bounds?: Bounds; anchor?: Position }
export interface Cell { pos: Position; terrain: string; traversability: string }
export interface Portal { id: string; spaceId: string; targetSpaceId: string; targetTpId: string; bounds: Bounds; arrival: Position }
export interface Agent {
  id: string; name: string; position: Position; status: string; profession?: string;
  isOpenToTalk?: boolean; inventory?: Record<string, number>;
  vitals?: { health: number; maxHealth: number };
  activeAction?: { type?: string; kind?: string } | null;
}
export interface CityEvent {
  eventId: string; emittedAt: number; tick: number;
  payload: { kind: string; agentId?: string; targetAgentId?: string; text?: string; threadId?: string };
}
export interface CityObject {
  id?: string; name?: string; kind?: string; position?: Position; state?: string;
  available?: boolean; health?: number; remainingUses?: number; status?: string;
}
export interface StaticWorld { spaces: Space[]; areas: Area[]; cells: Record<string, Cell>; teleports: Portal[] }
export interface DynamicWorld {
  agents: Agent[]; tick: number; timestamp: number; tickRateMs?: number;
  resourceNodes?: CityObject[]; npcs?: CityObject[]; enemies?: CityObject[];
  merchantOutlets?: CityObject[]; constructionSites?: CityObject[];
}
export interface WorldState {
  agentSeeds?: Record<string, unknown>;
  staticWorld: StaticWorld; dynamicWorld: DynamicWorld; events: CityEvent[];
  staticVersion: string; sequence: number; receivedAt: number;
}
export interface Delta {
  type: string; staticVersion: string; fromSequence: number; toSequence: number;
  batch: { agentPatches?: { id: string; set: Partial<Agent>; unset?: string[] }[];
    agentUpdates?: Agent[]; removedAgentIds?: string[]; events?: CityEvent[]; tick: number; timestamp: number;
    resourceNodeUpdates?: CityObject[]; removedResourceNodeIds?: string[];
    npcUpdates?: CityObject[]; removedNpcNames?: string[];
    enemyUpdates?: CityObject[]; removedEnemyIds?: string[];
    constructionSiteUpdates?: CityObject[]; removedConstructionSiteIds?: string[] };
}

function mergeObjects(existing: CityObject[] = [], updates: CityObject[] = [], removed: string[] = [], key: 'id' | 'name' = 'id') {
  if (!updates.length && !removed.length) return existing;
  const objects = new Map(existing.map(object => [object[key], object]));
  for (const object of updates) if (object[key]) objects.set(object[key], { ...objects.get(object[key]), ...object });
  for (const id of removed) objects.delete(id);
  return [...objects.values()];
}

export function mergeEvents(existing: CityEvent[], incoming: CityEvent[]): CityEvent[] {
  const byId = new Map(existing.map(event => [event.eventId, event]));
  for (const event of incoming) if (event.eventId && event.payload) byId.set(event.eventId, event);
  return [...byId.values()].sort((left, right) => left.emittedAt - right.emittedAt).slice(-160);
}

export function applyDelta(state: WorldState, delta: Delta): WorldState {
  if (delta.staticVersion !== state.staticVersion || delta.fromSequence !== state.sequence) throw new Error('The live stream needs a fresh snapshot.');
  const agents = new Map(state.dynamicWorld.agents.map(agent => [agent.id, agent]));
  for (const agent of delta.batch.agentUpdates ?? []) agents.set(agent.id, agent);
  for (const patch of delta.batch.agentPatches ?? []) {
    const previous = agents.get(patch.id);
    if (!previous && (!patch.set.name || !patch.set.position)) throw new Error('A new resident requires a fresh snapshot.');
    const updated = { ...previous, ...patch.set, id: patch.id } as Agent;
    for (const key of patch.unset ?? []) if (!['id', 'name', 'position'].includes(key)) Reflect.deleteProperty(updated, key);
    agents.set(patch.id, updated);
  }
  for (const id of delta.batch.removedAgentIds ?? []) agents.delete(id);
  return { ...state, sequence: delta.toSequence, receivedAt: Date.now(),
    events: mergeEvents(state.events, delta.batch.events ?? []),
    dynamicWorld: { ...state.dynamicWorld, agents: [...agents.values()], tick: delta.batch.tick, timestamp: delta.batch.timestamp,
      resourceNodes: mergeObjects(state.dynamicWorld.resourceNodes, delta.batch.resourceNodeUpdates, delta.batch.removedResourceNodeIds),
      npcs: mergeObjects(state.dynamicWorld.npcs, delta.batch.npcUpdates, delta.batch.removedNpcNames, 'name'),
      enemies: mergeObjects(state.dynamicWorld.enemies, delta.batch.enemyUpdates, delta.batch.removedEnemyIds),
      constructionSites: mergeObjects(state.dynamicWorld.constructionSites, delta.batch.constructionSiteUpdates, delta.batch.removedConstructionSiteIds) } };
}

export function isWalkable(world: StaticWorld, spaceId: string, horizontal: number, depth: number, radius = 0.23): boolean {
  for (const offsetX of [-radius, radius]) for (const offsetY of [-radius, radius]) {
    const cell = world.cells[`${spaceId},${Math.floor(horizontal + offsetX)},${Math.floor(depth + offsetY)}`];
    if (!cell || cell.traversability !== 'walkable') return false;
  }
  return true;
}

export function nearestWalkable(world: StaticWorld, space: Space, requested: Position): Position {
  let closest: Position | undefined;
  let distance = Infinity;
  for (let row = 0; row < space.height; row++) for (let column = 0; column < space.width; column++) {
    if (!isWalkable(world, space.id, column + 0.5, row + 0.5)) continue;
    const candidate = (column + 0.5 - requested.x) ** 2 + (row + 0.5 - requested.y) ** 2;
    if (candidate < distance) { distance = candidate; closest = { spaceId: space.id, x: column + 0.5, y: row + 0.5 }; }
  }
  if (!closest) throw new Error('This space has no supported walking surface.');
  return closest;
}

export function moveVisitor(world: StaticWorld, position: Position, horizontal: number, depth: number): Position {
  const steps = Math.max(1, Math.ceil(Math.hypot(horizontal, depth) / 0.12));
  let next = { ...position };
  for (let step = 0; step < steps; step++) {
    if (isWalkable(world, position.spaceId, next.x + horizontal / steps, next.y)) next.x += horizontal / steps;
    if (isWalkable(world, position.spaceId, next.x, next.y + depth / steps)) next.y += depth / steps;
  }
  return next;
}

export function portalDestination(world: StaticWorld, portal: Portal): Position | undefined {
  return world.teleports.find(candidate => candidate.id === portal.targetTpId && candidate.spaceId === portal.targetSpaceId)?.arrival
    ?? world.spaces.find(space => space.id === portal.targetSpaceId)?.entry;
}

export function officialAgentUrl(agent: Agent): string {
  const url = new URL(`/spaces/${encodeURIComponent(agent.position.spaceId)}`, 'https://www.midnight.city');
  url.searchParams.set('agent', agent.id);
  return url.href;
}
