const store = new Map<string, { html: string; createdAt: number }>();
const ONE_DAY = 24 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now - entry.createdAt > ONE_DAY) store.delete(id);
  }
}, 60 * 60 * 1000);

export function storeDmLog(html: string): string {
  const id = crypto.randomUUID();
  store.set(id, { html, createdAt: Date.now() });
  return id;
}

export function getDmLog(id: string): string | null {
  return store.get(id)?.html ?? null;
}
