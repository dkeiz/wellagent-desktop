class RateLimiter {
  constructor(windowMs, maxHits) {
    this.windowMs = Math.max(1000, Number(windowMs) || 60_000);
    this.maxHits = Math.max(1, Number(maxHits) || 10);
    this.hits = new Map();
  }

  check(key) {
    const now = Date.now();
    const bucketKey = String(key || 'anonymous');
    const bucket = this.hits.get(bucketKey) || [];
    const valid = bucket.filter(timestamp => now - timestamp < this.windowMs);
    if (valid.length >= this.maxHits) {
      const oldest = valid[0] || now;
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((this.windowMs - (now - oldest)) / 1000))
      };
    }
    valid.push(now);
    this.hits.set(bucketKey, valid);
    return { allowed: true, retryAfterSec: 0 };
  }
}

module.exports = { RateLimiter };
