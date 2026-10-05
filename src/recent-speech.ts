import type { CityEvent } from './world';

export interface SpeechLine {
  eventId: string;
  agentId: string;
  targetAgentId: string;
  text: string;
  emittedAt: number;
  expiresAt: number;
}

export class RecentSpeech {
  private lines = new Map<string, SpeechLine>();
  private seen = new Set<string>();

  update(events: CityEvent[], worldTime: number, now: number) {
    for (const event of events) {
      if (this.seen.has(event.eventId)) continue;
      this.seen.add(event.eventId);
      const { kind, agentId, targetAgentId, text } = event.payload;
      if (kind !== 'agent_spoke' || !agentId || !targetAgentId || agentId === targetAgentId || typeof text !== 'string' || !text.trim() || !Number.isFinite(event.emittedAt)) continue;
      const duration = Math.min(25000, Math.max(12000, text.length * 65));
      const age = Math.max(0, worldTime - event.emittedAt);
      if (age >= duration || event.emittedAt > worldTime + 5000) continue;
      const previous = this.lines.get(agentId);
      if (previous && previous.emittedAt >= event.emittedAt) continue;
      this.lines.set(agentId, { eventId: event.eventId, agentId, targetAgentId, text, emittedAt: event.emittedAt, expiresAt: now + duration - age });
    }
    while (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    this.read(now);
    while (this.lines.size > 64) this.lines.delete(this.lines.keys().next().value!);
  }

  read(now: number) {
    for (const [agentId, line] of this.lines) if (now >= line.expiresAt) this.lines.delete(agentId);
    return this.lines.values();
  }
}
