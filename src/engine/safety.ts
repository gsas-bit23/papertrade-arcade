export const PRICE_MAX_AGE_MS = 10_000;
export const CHAIN_MAX_AGE_MS = 15_000;
export function isFresh(timestamp: number, maxAge: number, now = Date.now()): boolean {
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + 1000 && now - timestamp <= maxAge;
}
export function assertReadSuccess(results: readonly { status: string; error?: unknown }[], label: string) {
  const failed = results.findIndex(r => r.status !== 'success');
  if (failed !== -1) throw new Error(`${label} read ${failed + 1} failed. Data is unavailable; actions are disabled.`);
}
export interface QueueLink { user: string; amount: bigint; next: bigint }
export async function sumUserQueue(head: bigint, user: string, read: (id: bigint) => Promise<QueueLink>, limit = 1000) {
  let amount = 0n, executable = 0n, id = head;
  const seen = new Set<bigint>();
  while (id !== 0n) {
    if (id < 0n || seen.has(id) || seen.size >= limit) throw new Error('Queue traversal is incomplete or cyclic; balance unavailable.');
    seen.add(id);
    const node = await read(id);
    if (node.user.toLowerCase() !== user.toLowerCase() || node.amount < 0n) throw new Error('Invalid user queue node.');
    amount += node.amount;
    if (seen.size <= 50) executable += node.amount;
    id = node.next;
  }
  return { amount, executable };
}
