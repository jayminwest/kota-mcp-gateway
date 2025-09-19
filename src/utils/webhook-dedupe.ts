type Timestamp = number;

interface Entry {
  expiresAt: Timestamp;
}

export class WebhookDeduper {
  private readonly ttlMs: number;
  private readonly seen = new Map<string, Entry>();

  constructor(ttlSeconds = 60 * 60) {
    this.ttlMs = ttlSeconds * 1000;
  }

  private sweep(now: Timestamp): void {
    for (const [key, entry] of this.seen.entries()) {
      if (entry.expiresAt <= now) {
        this.seen.delete(key);
      }
    }
  }

  has(key: string): boolean {
    if (!key) return false;
    const now = Date.now();
    this.sweep(now);
    const hit = this.seen.has(key);
    if (!hit) {
      this.seen.set(key, { expiresAt: now + this.ttlMs });
    }
    return hit;
  }
}
