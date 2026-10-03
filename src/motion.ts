import type { Position } from './world';

interface Sample { time: number; position: Position }

export class MotionTrack {
  private samples: Sample[] = [];

  push(position: Position, time: number) {
    const last = this.samples.at(-1);
    if (last && time <= last.time) return;
    if (last && (position.spaceId !== last.position.spaceId || time - last.time > 4000)) this.samples = [];
    this.samples.push({ time, position: { ...position } });
    if (this.samples.length > 16) this.samples.shift();
  }

  write(time: number, output: { x: number; z: number }) {
    if (!this.samples.length) return;
    let previous = this.samples[0], next = previous;
    for (const sample of this.samples) {
      next = sample;
      if (sample.time > time) break;
      previous = sample;
    }
    const distance = Math.hypot(next.position.x - previous.position.x, next.position.y - previous.position.y);
    const fraction = next.time > previous.time && distance <= 8 ? Math.max(0, Math.min(1, (time - previous.time) / (next.time - previous.time))) : 0;
    output.x = previous.position.x + (next.position.x - previous.position.x) * fraction + 0.5;
    output.z = previous.position.y + (next.position.y - previous.position.y) * fraction + 0.5;
  }
}

export class PlaybackClock {
  private offsets: number[] = [];
  private offset = 0;
  private cursor = 0;
  private previous = 0;
  private delay = 750;

  observe(serverTime: number, localTime: number, tickMs = 500) {
    if (!Number.isFinite(serverTime)) return;
    this.delay = Math.max(150, Math.min(2000, tickMs * 1.5));
    const offset = serverTime - localTime;
    if (!this.offsets.length || Math.abs(offset - this.offset) > 4000) {
      this.offsets = []; this.cursor = serverTime - this.delay; this.previous = localTime;
    }
    this.offsets.push(offset);
    if (this.offsets.length > 16) this.offsets.shift();
    this.offset = Math.max(...this.offsets);
  }

  read(localTime: number) {
    const elapsed = Math.max(0, localTime - this.previous);
    const desired = localTime + this.offset - this.delay;
    if (elapsed > 2000) this.cursor = desired;
    else this.cursor += elapsed * Math.max(0.95, Math.min(1.05, 1 + (desired - this.cursor - elapsed) / 500));
    this.previous = localTime;
    return this.cursor;
  }
}
