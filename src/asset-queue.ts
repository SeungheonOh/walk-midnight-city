export function modelLoadConcurrency(capabilities: { hardwareConcurrency?: number; deviceMemory?: number }) {
  const processors = typeof capabilities.hardwareConcurrency === 'number' && capabilities.hardwareConcurrency > 0 ? capabilities.hardwareConcurrency : Infinity;
  const memory = typeof capabilities.deviceMemory === 'number' && capabilities.deviceMemory > 0 ? capabilities.deviceMemory : Infinity;
  if (processors <= 2 || memory <= 2) return 1;
  if (processors <= 4 || memory <= 4) return 2;
  return 4;
}

export class AssetQueue {
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid asset concurrency');
  }

  async run<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await operation(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
