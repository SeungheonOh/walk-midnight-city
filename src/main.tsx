import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { ArrowLeft, ArrowUpRight, Compass, ExternalLink, Footprints, HelpCircle, MapPin, MessageCircle, Navigation, Search, Users, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { connectWorld, type ConnectionStatus } from './connection';
import { CityScene } from './native-scene';
import type { FocusTarget } from './scene';
import { officialAgentUrl, portalDestination, type Agent, type CityObject, type Position, type Space, type WorldState } from './world';
import './style.css';

function cn(...values: ClassValue[]) { return twMerge(clsx(values)); }

function MiniMap({ world, space, position, heading, onVisit }: { world: WorldState; space: Space; position: Position; heading: number; onVisit: (position: Position) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useMemo(() => {
    const image = document.createElement('canvas'); image.width = space.width; image.height = space.height;
    const context = image.getContext('2d')!;
    for (let row = 0; row < space.height; row++) for (let column = 0; column < space.width; column++) {
      const cell = world.staticWorld.cells[`${space.id},${column},${row}`];
      context.fillStyle = cell?.terrain === 'water' ? '#224a62' : cell?.traversability === 'walkable' ? '#4b596a' : '#1a2632';
      context.fillRect(column, row, 1, 1);
    }
    return image;
  }, [world.staticWorld, space]);
  useEffect(() => {
    const context = canvas.current?.getContext('2d'); if (!context) return;
    const width = 256, height = 180, scale = Math.min(width / space.width, height / space.height);
    const offsetX = (width - space.width * scale) / 2, offsetY = (height - space.height * scale) / 2;
    context.clearRect(0, 0, width, height); context.imageSmoothingEnabled = false;
    context.drawImage(base, offsetX, offsetY, space.width * scale, space.height * scale);
    context.fillStyle = '#dce3ec';
    for (const agent of world.dynamicWorld.agents) if (agent.position.spaceId === space.id) {
      context.fillRect(offsetX + (agent.position.x + 0.5) * scale, offsetY + (agent.position.y + 0.5) * scale, 2, 2);
    }
    context.save(); context.translate(offsetX + position.x * scale, offsetY + position.y * scale); context.rotate(-heading);
    context.fillStyle = '#bef264'; context.beginPath(); context.moveTo(0, -7); context.lineTo(5, 5); context.lineTo(0, 2); context.lineTo(-5, 5); context.closePath(); context.fill(); context.restore();
  }, [base, world.dynamicWorld.agents, position, heading, space]);
  return <div className="panel overflow-hidden">
    <div className="flex items-center justify-between px-4 py-3 text-xs"><span className="flex items-center gap-2"><Compass className="size-3.5 text-lime-300" /> {space.name}</span><span className="font-mono text-slate-400">N ↑</span></div>
    <canvas ref={canvas} width={256} height={180} className="block w-full cursor-crosshair" aria-label={`Map of ${space.name}. Lime arrow is your visitor position.`} onClick={event => {
      const rectangle = event.currentTarget.getBoundingClientRect(), scale = Math.min(256 / space.width, 180 / space.height);
      onVisit({ spaceId: space.id, x: ((event.clientX - rectangle.left) * 256 / rectangle.width - (256 - space.width * scale) / 2) / scale,
        y: ((event.clientY - rectangle.top) * 180 / rectangle.height - (180 - space.height * scale) / 2) / scale });
    }} />
    <p className="px-4 py-3 text-xs text-slate-400">Click to relocate your view. No agent moves.</p>
  </div>;
}

interface Thread { threadId: string; latestMessagePreview: string; initiatorAgentId: string; recipientAgentId: string; totalMessageCount: number }
interface Message { messageId: string; messageBody: string; senderAgentId: string; messageCreatedAtMs: number; sequenceNo: number }

function Conversations({ agent, names }: { agent: Agent; names: Map<string, string> }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    const path = threadId ? `/threads/${encodeURIComponent(threadId)}/messages?limit=50` : `/agents/${encodeURIComponent(agent.id)}/threads?limit=8`;
    fetch(`https://www.midnight.city/observer/api${path}`, { credentials: 'omit', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]) })
      .then(async response => { if (!response.ok) throw new Error(`Conversation unavailable (${response.status}).`); return response.json(); })
      .then(data => {
        if (abort.signal.aborted) return;
        if (threadId) {
          if (!Array.isArray(data.messages)) throw new Error('The conversation format has changed.');
          setMessages(data.messages.sort((left: Message, right: Message) => left.sequenceNo - right.sequenceNo));
        } else {
          if (!Array.isArray(data.threads)) throw new Error('The conversation list format has changed.');
          setThreads(data.threads);
        }
      }).catch(error => { if (!abort.signal.aborted) setError(error.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [agent.id, threadId, refresh]);
  return <section className="space-y-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Public conversations</h3><Button className="text-xs text-lime-300" onClick={() => setRefresh(refresh + 1)}>Refresh</Button></div>
    {threadId && <Button className="flex items-center gap-2 text-xs text-slate-400" onClick={() => setThreadId(null)}><ArrowLeft className="size-3" /> All conversations</Button>}
    {loading ? <p role="status" className="text-sm text-slate-400">Reading the public conversation…</p> : error ? <p role="alert" className="text-sm text-amber-300">{error}</p> : threadId ? <div className="space-y-4">{messages.map(message => <article key={message.messageId} className="border-l border-slate-600 pl-3"><p className="mb-1 text-xs text-lime-300">{names.get(message.senderAgentId) ?? 'City resident'}</p><p className="text-pretty text-sm leading-relaxed text-slate-300">{message.messageBody}</p></article>)}{messages.length === 0 && <p className="text-sm text-slate-400">No public messages are available. Try Refresh.</p>}</div> : <div className="space-y-2">{threads.map(thread => <Button key={thread.threadId} className="w-full rounded-lg border border-slate-700/70 p-3 text-left hover:bg-slate-800" onClick={() => setThreadId(thread.threadId)}><p className="mb-2 text-xs text-slate-400">{names.get(thread.initiatorAgentId) ?? 'Resident'} ↔ {names.get(thread.recipientAgentId) ?? 'Resident'}</p><p className="line-clamp-3 text-pretty text-sm text-slate-200">{thread.latestMessagePreview}</p><p className="mt-2 text-xs text-lime-300">Read {thread.totalMessageCount} messages →</p></Button>)}{threads.length === 0 && <p className="text-sm text-slate-400">No public conversations yet. Refresh to check again.</p>}</div>}
  </section>;
}

function App() {
  const mount = useRef<HTMLDivElement>(null), engine = useRef<CityScene | null>(null), worldRef = useRef<WorldState | null>(null);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('loading');
  const [connectionMessage, setConnectionMessage] = useState('Connecting to Midnight City');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [entered, setEntered] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<Position>({ spaceId: 'central', x: 72, y: 65 });
  const [heading, setHeading] = useState(0);
  const [target, setTarget] = useState<FocusTarget | null>(null);
  const [assets, setAssets] = useState({ loading: 0, failed: 0 });
  const [visit, setVisit] = useState<{ spaceId: string; requested?: Position }>({ spaceId: 'central' });
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedObject, setSelectedObject] = useState<CityObject | null>(null);

  const interact = useCallback((target: FocusTarget) => {
    if (target.kind === 'agent') { setSelectedId(target.id); setPeopleOpen(true); }
    else if (target.kind === 'object') setSelectedObject(target.object);
    else if (worldRef.current) {
      const destination = portalDestination(worldRef.current.staticWorld, target.portal);
      if (destination) setVisit({ spaceId: destination.spaceId, requested: destination });
    }
  }, []);

  useEffect(() => {
    try {
      engine.current = new CityScene(mount.current!, { position: (position, heading) => { setPosition(position); setHeading(heading); },
        focus: setTarget, interact, locked: value => { setLocked(value); if (value) { setEntered(true); setError(''); } },
        error: setError, assets: (loading, failed) => setAssets(previous => previous.loading === loading && previous.failed === failed ? previous : { loading, failed }) });
    } catch { setError('This browser could not start WebGL. Enable hardware acceleration and reload.'); }
    const disconnect = connectWorld(value => { worldRef.current = value; engine.current?.update(value); setWorld(value); }, (status, message) => { setStatus(status); setConnectionMessage(message ?? 'Receiving live city updates'); });
    return () => { disconnect(); engine.current?.dispose(); engine.current = null; };
  }, [interact]);

  useEffect(() => {
    if (!worldRef.current || !engine.current) return;
    engine.current.update(worldRef.current);
    try { engine.current.visit(visit.spaceId, visit.requested); setError(''); } catch (error) { setError(error instanceof Error ? error.message : 'This location is unavailable.'); }
  }, [world?.staticVersion, visit]);

  const selected = world?.dynamicWorld.agents.find(agent => agent.id === selectedId);
  const names = useMemo(() => new Map(world?.dynamicWorld.agents.map(agent => [agent.id, agent.name])), [world?.dynamicWorld.agents]);
  const space = world?.staticWorld.spaces.find(space => space.id === position.spaceId);
  const residents = useMemo(() => (world?.dynamicWorld.agents ?? []).filter(agent => agent.position.spaceId === position.spaceId), [world?.dynamicWorld.agents, position.spaceId]);
  const nearby = useMemo(() => {
    if (!peopleOpen || selectedId) return [];
    const search = query.toLocaleLowerCase();
    return residents.filter(agent => agent.name.toLocaleLowerCase().includes(search)).sort((left, right) =>
      (left.position.x + 0.5 - position.x) ** 2 + (left.position.y + 0.5 - position.y) ** 2 - ((right.position.x + 0.5 - position.x) ** 2 + (right.position.y + 0.5 - position.y) ** 2));
  }, [residents, query, position.x, position.y, peopleOpen, selectedId]);
  const localEvents = useMemo(() => {
    const ids = new Set(residents.map(agent => agent.id));
    return (world?.events ?? []).filter(event => event.payload.text && ids.has(event.payload.agentId ?? '')).slice(-3).reverse();
  }, [world?.events, residents]);
  const startWalk = () => { setSelectedId(null); setPeopleOpen(false); setEntered(true); engine.current?.lock(); };
  const relocate = (requested: Position) => { engine.current?.unlock(); setVisit({ spaceId: requested.spaceId, requested }); };

  return <main className="relative h-dvh min-h-96 overflow-hidden bg-slate-950 text-slate-100">
    <div ref={mount} className="absolute inset-0" />
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4 sm:p-6">
      <div className="panel pointer-events-auto flex items-center gap-3 px-4 py-3"><Footprints className="size-6 text-lime-300" /><div><h1 className="text-balance text-lg font-semibold">Walk Midnight<span className="ml-2 text-xs font-normal text-slate-400">alpha</span></h1><p className="mt-0.5 text-xs text-slate-400">An independent window into the real city</p></div></div>
      <div className="pointer-events-auto flex items-center gap-2">
        {!locked && world && <Button className="primary-button" onClick={startWalk}><Footprints className="size-4" />Walk</Button>}
        <div className="panel hidden items-center gap-2 px-3 py-2.5 text-xs sm:flex"><span className={cn('size-1.5 rounded-full', status === 'live' ? 'bg-lime-300' : 'bg-amber-300')} /><span>{status === 'live' ? 'Live city' : status === 'loading' ? 'Connecting' : 'Reconnecting'}</span></div>
        <Button className="icon-button" aria-label="Walking help" onClick={() => { engine.current?.unlock(); setHelpOpen(true); }}><HelpCircle className="size-5" /></Button>
        <Button className={cn('icon-button', peopleOpen && 'border-lime-300/50 text-lime-300')} aria-label="Show nearby residents" onClick={() => { engine.current?.unlock(); setPeopleOpen(!peopleOpen); }}><Users className="size-5" /></Button>
      </div>
    </header>

    <div className="pointer-events-none absolute left-1/2 top-28 z-10 -translate-x-1/2 sm:top-6"><div className="panel px-4 py-2 text-center font-mono text-xs text-slate-300"><span className="text-slate-500">VISITOR</span> <span className="tabular-nums" data-testid="visitor-position">{position.x.toFixed(1)} / {position.y.toFixed(1)}</span><span className="ml-3 text-slate-500">{space?.name ?? 'Central'}</span></div></div>

    {!locked && !selected && <div className={cn('pointer-events-none absolute inset-0 z-10 flex items-center justify-center', peopleOpen && 'lg:pr-96')}>
      <section className="panel pointer-events-auto mx-5 w-80 p-6 text-center">
        <span className="mb-4 inline-flex size-12 items-center justify-center rounded-full border border-lime-300/25 bg-lime-300/10 text-lime-300"><Footprints className="size-6" /></span>
        <h2 className="text-balance text-2xl font-medium">{entered ? 'Take another walk.' : 'The city, at street level.'}</h2>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-400">{world ? 'Real residents. Live conversations. You are a visitor—no agent is taken over.' : 'Loading the real map and residents from Midnight City. No simulated fallback.'}</p>
        <Button className="primary-button mt-5 w-full" onClick={startWalk} disabled={!world || !!error && !engine.current}><Footprints className="size-4" />{entered ? 'Resume walking' : world ? 'Walk into the city' : 'Connecting…'}</Button>
        <p className="mt-4 text-xs text-slate-500">WASD move · Mouse look · E interact · Esc pause</p>
      </section>
    </div>}

    {locked && <><div className="pointer-events-none absolute left-1/2 top-1/2 z-10 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 bg-black/20" />{target && <div className="panel pointer-events-none absolute bottom-28 left-1/2 z-10 -translate-x-1/2 px-5 py-3 text-sm"><kbd>E</kbd><span className="ml-3">{target.kind === 'portal' ? 'Enter' : target.kind === 'object' ? 'Inspect' : 'Meet'} <strong className="font-medium text-lime-300">{target.name}</strong></span></div>}</>}

    <aside className="absolute bottom-6 left-6 z-10 hidden w-64 space-y-3 md:block">
      {world && space && !locked && <label className="panel flex items-center gap-3 px-3 py-2 text-xs"><MapPin className="size-4 text-lime-300" /><span className="sr-only">Explore a space</span><select aria-label="Explore a space" className="w-full bg-transparent p-1 text-slate-200 outline-none" value={position.spaceId} onChange={event => setVisit({ spaceId: event.target.value })}>{world.staticWorld.spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>}
      {world && space && <MiniMap world={world} space={space} position={position} heading={heading} onVisit={relocate} />}
    </aside>

    {peopleOpen && <aside aria-label="Residents and conversations" className="panel absolute bottom-24 right-4 top-36 z-20 flex w-80 max-w-[calc(100%-2rem)] flex-col overflow-hidden sm:bottom-6 sm:right-6 sm:top-24 sm:w-88">
      <div className="flex items-center justify-between border-b border-slate-700/70 p-4"><div className="flex items-center gap-2"><Users className="size-4 text-lime-300" /><h2 className="text-balance text-sm font-medium">{selected ? 'Meet a resident' : 'In the neighborhood'}</h2><span className="text-xs tabular-nums text-slate-500">{residents.length}</span></div><Button aria-label="Close residents" className="text-slate-400 hover:text-white" onClick={() => setPeopleOpen(false)}><X className="size-4" /></Button></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selected ? <div className="space-y-6">
          <Button className="flex items-center gap-2 text-xs text-slate-400" onClick={() => setSelectedId(null)}><ArrowLeft className="size-3" /> All residents</Button>
          <div><p className="text-xs text-lime-300">LIVE RESIDENT</p><h3 className="mt-2 break-words text-2xl font-medium">{selected.name}</h3><p className="mt-1 text-sm capitalize text-slate-400">{selected.profession ?? 'Resident'} · {selected.status.replaceAll('_', ' ')}</p><p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><MapPin className="size-3" />{world?.staticWorld.spaces.find(space => space.id === selected.position.spaceId)?.name ?? selected.position.spaceId} · {selected.position.x}, {selected.position.y}</p></div>
          <div className="grid grid-cols-2 gap-2"><Button className="secondary-button" onClick={() => { relocate(selected.position); setPeopleOpen(false); }}><Navigation className="size-3.5" /> Walk nearby</Button><a className="secondary-button" href={officialAgentUrl(selected)} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3.5" /> Official profile</a></div>
          <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3"><p className="flex items-center gap-2 text-sm"><MessageCircle className="size-4 text-lime-300" /> Visitor chat</p><p className="mt-2 text-pretty text-xs leading-relaxed text-slate-400">Midnight City’s public feed has no verified guest-message channel. Read real conversations below; signed-in interactions stay on the official site. We never speak as this agent.</p></section>
          {selected.vitals && <div className="flex justify-between text-xs text-slate-400"><span>Health</span><span className="tabular-nums text-slate-200">{selected.vitals.health} / {selected.vitals.maxHealth}</span></div>}
          <Conversations key={selected.id} agent={selected} names={names} />
          {selected.inventory && <section><h3 className="mb-3 text-sm font-medium">Carrying</h3><dl className="space-y-2">{Object.entries(selected.inventory).slice(0,12).map(([item, quantity]) => <div key={item} className="flex justify-between gap-4 text-xs"><dt className="capitalize text-slate-400">{item.replaceAll('_',' ')}</dt><dd className="tabular-nums">{quantity.toLocaleString()}</dd></div>)}</dl></section>}
        </div> : <><label className="mb-4 flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2"><Search className="size-4 text-slate-500" /><input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500" aria-label="Find a resident" placeholder="Find a resident…" value={query} onChange={event => setQuery(event.target.value)} /></label><p className="mb-3 text-xs text-slate-500">Closest to your visitor position</p><div className="space-y-1">{nearby.map(agent => <Button key={agent.id} onClick={() => setSelectedId(agent.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-slate-800"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm text-slate-300">{agent.name.slice(0,1)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{agent.name}</span><span className="block truncate text-xs text-slate-500">{agent.status.replaceAll('_',' ')}</span></span><span className="text-xs tabular-nums text-slate-500">{Math.round(Math.hypot(agent.position.x + 0.5 - position.x, agent.position.y + 0.5 - position.y))} tiles</span></Button>)}{nearby.length === 0 && <p className="text-sm text-slate-400">{query ? 'No match. Try another name.' : 'No residents here right now. Explore another space.'}</p>}</div></>}
      </div>
      <p className="border-t border-slate-700/70 px-4 py-3 text-xs text-slate-500">Live residents · Original Midnight City sprites</p>
    </aside>}

    {locked && !peopleOpen && localEvents[0] && <div className="panel pointer-events-none absolute right-6 top-24 z-10 hidden w-80 p-4 lg:block"><p className="mb-2 text-xs text-lime-300">Overheard in {space?.name}</p><p className="mb-1 text-xs text-slate-400">{names.get(localEvents[0].payload.agentId ?? '') ?? 'A resident'}</p><p className="line-clamp-4 text-pretty text-sm leading-relaxed text-slate-200">{localEvents[0].payload.text}</p><p className="mt-2 text-xs text-slate-500">Public agent dialogue, not a message to you</p></div>}

    <footer className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex flex-col items-center gap-2 px-4 text-center">
      {(error || status !== 'live') && <p role="status" className="panel max-w-md px-4 py-2 text-xs text-amber-200">{error || connectionMessage}{world && status !== 'live' ? ' Displaying the last received state.' : ''}</p>}
      {(assets.loading > 0 || assets.failed > 0) && <p className="panel px-3 py-1.5 text-xs text-slate-400">{assets.loading > 0 ? `Loading ${assets.loading} city models…` : `${assets.failed} city models unavailable · map geometry remains active`}</p>}
      <div className="panel px-4 py-2 text-xs text-slate-400"><span className="text-slate-200">WASD</span> move <span className="mx-2 text-slate-600">/</span><span className="text-slate-200">Shift</span> run <span className="mx-2 text-slate-600">/</span><span className="text-slate-200">E</span> meet / enter <span className="mx-2 text-slate-600">/</span><span className="text-slate-200">Esc</span> release</div>
    </footer>

    <Dialog.Root open={!!selectedObject} onOpenChange={open => { if (!open) setSelectedObject(null); }}><Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-40 bg-black/70" /><Dialog.Popup className="panel fixed left-1/2 top-1/2 z-50 w-96 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 p-6">
      <div className="flex items-center justify-between gap-4"><Dialog.Title className="text-xl font-medium">{selectedObject?.name ?? selectedObject?.id?.replaceAll('_', ' ') ?? 'City object'}</Dialog.Title><Dialog.Close aria-label="Close object details"><X className="size-5" /></Dialog.Close></div>
      <Dialog.Description className="mt-3 text-sm text-slate-400">A real city object at {selectedObject?.position?.x}, {selectedObject?.position?.y}. Inspecting it does not perform any agent action.</Dialog.Description>
      <dl className="mt-5 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt>Type</dt><dd>{selectedObject?.kind?.replaceAll('_', ' ') ?? 'City creature'}</dd></div><div className="flex justify-between"><dt>Observed state</dt><dd>{selectedObject?.state ?? selectedObject?.status ?? 'Present'}</dd></div>{selectedObject?.remainingUses !== undefined && <div className="flex justify-between"><dt>Remaining uses</dt><dd>{selectedObject.remainingUses}</dd></div>}{selectedObject?.health !== undefined && <div className="flex justify-between"><dt>Health</dt><dd>{selectedObject.health}</dd></div>}</dl>
      <p className="mt-5 text-xs text-slate-500">Live position and state · Representative object appearance</p>
    </Dialog.Popup></Dialog.Portal></Dialog.Root>

    <Dialog.Root open={helpOpen} onOpenChange={setHelpOpen}><Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-40 bg-black/70" /><Dialog.Popup className="panel fixed left-1/2 top-1/2 z-50 w-96 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 p-6"><div className="flex items-center justify-between"><Dialog.Title className="text-balance text-xl font-medium">Your own way through.</Dialog.Title><Dialog.Close className="text-slate-400" aria-label="Close help"><X className="size-5" /></Dialog.Close></div><Dialog.Description className="mt-3 text-pretty text-sm leading-relaxed text-slate-400">You are a local visitor camera in the real live map. Your movements do not move or control any resident.</Dialog.Description><ul className="my-5 space-y-3 text-sm text-slate-300"><li>WASD to walk. Shift to run. Mouse to look.</li><li>Arrow keys also turn the camera when the world has focus.</li><li>Look at a nearby resident and press E to inspect.</li><li>Approach a doorway and press E to enter.</li><li>Escape releases the mouse. Click the map to relocate.</li></ul><p className="text-pretty text-xs leading-relaxed text-slate-500">An independent walking view of Midnight City's experimental 3D scene, with its original layouts, models, lighting, and 2D resident sprites. Visitor chat needs an official integration; no replies are generated or impersonated.</p><a className="mt-5 flex items-center gap-2 text-sm text-lime-300" href="https://www.midnight.city/spaces/central" target="_blank" rel="noopener noreferrer">Open the official city <ArrowUpRight className="size-4" /></a></Dialog.Popup></Dialog.Portal></Dialog.Root>
  </main>;
}

const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<App />);
