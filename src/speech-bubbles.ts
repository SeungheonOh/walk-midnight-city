import type { PerspectiveCamera, Vector3 } from 'three';
import { RecentSpeech, type SpeechLine } from './recent-speech';
import type { Agent, WorldState } from './world';

interface Bubble {
  element: HTMLElement;
  label: HTMLElement;
  body: HTMLElement;
  eventId: string;
}

export class SpeechBubbles {
  private speech = new RecentSpeech();
  private agents = new Map<string, Agent>();
  private bubbles = new Map<string, Bubble>();
  private layer = document.createElement('div');
  private resize: ResizeObserver;
  private width = 0;
  private height = 0;
  private point?: Vector3;
  private occlusion = new Map<string, boolean>();
  private occlusionAt = 0;
  private spaceId?: string;

  constructor(container: HTMLElement) {
    this.layer.className = 'speech-layer';
    this.layer.setAttribute('role', 'region');
    this.layer.setAttribute('aria-label', 'Nearby public conversations');
    container.append(this.layer);
    this.resize = new ResizeObserver(entries => {
      this.width = entries[0].contentRect.width;
      this.height = entries[0].contentRect.height;
    });
    this.resize.observe(container);
  }

  update(world: WorldState) {
    this.agents = new Map(world.dynamicWorld.agents.map(agent => [agent.id, agent]));
    this.speech.update(world.events, world.dynamicWorld.timestamp, performance.now());
  }

  hide() { this.layer.hidden = true; this.occlusion.clear(); }

  render(camera: PerspectiveCamera, spaceId: string, position: (id: string) => Vector3 | undefined, visible: (horizontal: number, height: number, depth: number) => boolean) {
    this.layer.hidden = false;
    const now = performance.now();
    if (spaceId !== this.spaceId || now - this.occlusionAt >= 100) {
      this.occlusion.clear(); this.occlusionAt = now; this.spaceId = spaceId;
    }
    const point = this.point ??= camera.position.clone();
    const candidates: { line: SpeechLine; agent: Agent; anchorX: number; anchorY: number; distance: number }[] = [];
    for (const line of this.speech.read(now)) {
      const agent = this.agents.get(line.agentId);
      if (agent?.position.spaceId !== spaceId) continue;
      const resident = position(line.agentId);
      if (!resident) continue;
      const distance = camera.position.distanceToSquared(resident);
      if (distance > 24 ** 2) continue;
      point.copy(resident); point.y += spaceId === 'ada-arena-interior' ? 9.5 : 2.6;
      point.project(camera);
      if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) continue;
      let unobstructed = this.occlusion.get(line.agentId);
      if (unobstructed === undefined) {
        unobstructed = visible(resident.x, resident.y + 1.2, resident.z);
        this.occlusion.set(line.agentId, unobstructed);
      }
      if (!unobstructed) continue;
      candidates.push({ line, agent, anchorX: (point.x + 1) * this.width / 2, anchorY: (1 - point.y) * this.height / 2, distance });
    }
    candidates.sort((left, right) => left.distance - right.distance || right.line.emittedAt - left.line.emittedAt);
    const shown = new Set<string>();
    const rectangles: { left: number; top: number; right: number; bottom: number }[] = [];
    const width = Math.min(288, this.width - 32);
    if (width <= 0) return;
    for (const { line, agent, anchorX, anchorY } of candidates) {
      if (shown.size >= 6) break;
      const top = anchorY - 140;
      if (top < 16) continue;
      const left = [anchorX - width / 2, anchorX - width + 20, anchorX - 20]
        .map(value => Math.max(16, Math.min(this.width - width - 16, value)))
        .find(value => !rectangles.some(rectangle => value < rectangle.right + 8 && value + width > rectangle.left - 8 && top < rectangle.bottom + 8 && anchorY > rectangle.top - 8));
      if (left === undefined) continue;
      let bubble = this.bubbles.get(line.agentId);
      if (!bubble) {
        const element = document.createElement('article');
        const label = document.createElement('p'), body = document.createElement('p');
        element.className = 'speech-bubble'; label.className = 'speech-speaker'; body.className = 'speech-message';
        element.dataset.agentId = line.agentId;
        element.append(label, body); this.layer.append(element);
        bubble = { element, label, body, eventId: '' }; this.bubbles.set(line.agentId, bubble);
      }
      if (bubble.eventId !== line.eventId) {
        bubble.label.textContent = `${agent.name} → ${this.agents.get(line.targetAgentId)?.name ?? 'Resident'}`;
        bubble.body.textContent = line.text;
        bubble.element.setAttribute('aria-label', `${bubble.label.textContent}: ${line.text}`);
        bubble.eventId = line.eventId;
      }
      const transform = `translate(${left.toFixed(1)}px, ${(anchorY - 12).toFixed(1)}px) translateY(-100%)`;
      if (bubble.element.style.transform !== transform) bubble.element.style.transform = transform;
      bubble.element.style.setProperty('--speech-tail', `${Math.max(12, Math.min(width - 12, anchorX - left)).toFixed(1)}px`);
      shown.add(line.agentId);
      rectangles.push({ left, top, right: left + width, bottom: anchorY });
    }
    for (const [agentId, bubble] of this.bubbles) if (!shown.has(agentId)) { bubble.element.remove(); this.bubbles.delete(agentId); }
  }

  dispose() { this.resize.disconnect(); this.layer.remove(); this.bubbles.clear(); }
}
