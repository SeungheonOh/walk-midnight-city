import type { WalkingSurface } from './walking-surface';

export class WalkingCache {
  private entries = new Map<string, WalkingSurface>();
  private bytes = 0;

  constructor(private limit = 32 * 1024 * 1024) { }

  get(key: string) {
    const surface = this.entries.get(key);
    if (surface) {
      this.entries.delete(key);
      this.entries.set(key, surface);
    }
    return surface;
  }

  set(key: string, surface: WalkingSurface) {
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.byteLength; this.entries.delete(key); }
    if (surface.byteLength > this.limit) return;
    while (this.bytes + surface.byteLength > this.limit && this.entries.size) {
      const [oldest, value] = this.entries.entries().next().value!;
      this.entries.delete(oldest);
      this.bytes -= value.byteLength;
    }
    this.entries.set(key, surface);
    this.bytes += surface.byteLength;
  }

  clear() { this.entries.clear(); this.bytes = 0; }
}
