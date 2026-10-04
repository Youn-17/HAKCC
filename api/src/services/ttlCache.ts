/**
 * 一个最小的进程内 TTL 缓存。
 *
 * 用途很窄：挡住那些「每个请求都要问 Supabase 一遍、但答案几秒内不会变」的查询。
 * 每次 Supabase 往返固定约 300ms，画布加载一次要串十来趟，这是延迟的大头。
 *
 * 单进程内存缓存，重启即清空；容量到顶就整体丢弃（不做 LRU，量小没必要）。
 * **不要**用它缓存授权判定 —— 权限被撤销后还能用一段时间是不能接受的。
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 5000,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxEntries) this.store.clear();
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
