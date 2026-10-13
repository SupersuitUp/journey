import type { Firestore } from 'firebase-admin/firestore'

// An in-memory stand-in for the slice of the Firestore Admin API the store uses: collections of
// documents, where() with ==, < and >, orderBy(), limit(), whole-collection reads, transactions
// and batches. Every write stores a deep copy and every read hands one back, so a store that edits
// what it read and forgets to write it is caught rather than hidden.
type Data = Record<string, unknown>
type Filter = (d: Data) => boolean
type Order = { field: string; dir: 'asc' | 'desc' }
let auto = 0

const cmp = (a: unknown, b: unknown) => ((a as string | number) < (b as string | number) ? -1 : (a as string | number) > (b as string | number) ? 1 : 0)
function filterOf(field: string, op: string, value: unknown): Filter {
  if (op === '==') return (d) => d[field] === value
  if (op === '<') return (d) => d[field] !== undefined && cmp(d[field], value) < 0
  if (op === '>') return (d) => d[field] !== undefined && cmp(d[field], value) > 0
  throw new Error(`the fake supports ==, < and > only, not ${op}`)
}

export function fakeFirestore() {
  const collections = new Map<string, Map<string, Data>>()
  const coll = (name: string) => {
    let c = collections.get(name)
    if (!c) { c = new Map(); collections.set(name, c) }
    return c
  }
  const snapshot = (name: string, id: string) => {
    const d = coll(name).get(id)
    return { id, exists: d !== undefined, data: () => (d === undefined ? undefined : structuredClone(d)), ref: ref(name, id) }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = (name: string, id: string): any => ({
    id, path: `${name}/${id}`, collectionName: name,
    get: async () => snapshot(name, id),
    set: async (data: Data) => { coll(name).set(id, structuredClone(data)) },
    delete: async () => { coll(name).delete(id) },
    // Firestore's create-once: refused when the document exists. No await before the check, so two
    // overlapping callers can never both create.
    create: async (data: Data) => {
      if (coll(name).has(id)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      coll(name).set(id, structuredClone(data))
    },
  })
  // A query is built up a call at a time and read with get(). As in Firestore, a document with no
  // value in the field it is ordered by is not in the result.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (name: string, filters: Filter[], order: Order | null, max: number | null): any => ({
    where: (field: string, op: string, value: unknown) => query(name, [...filters, filterOf(field, op, value)], order, max),
    orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => query(name, filters, { field, dir }, max),
    limit: (n: number) => query(name, filters, order, n),
    get: async () => {
      let rows = [...coll(name).entries()].filter(([, d]) => filters.every((keep) => keep(d)))
      if (order) {
        rows = rows.filter(([, d]) => d[order.field] !== undefined)
        rows.sort(([, a], [, b]) => cmp(a[order.field], b[order.field]) * (order.dir === 'desc' ? -1 : 1))
      }
      if (max !== null) rows = rows.slice(0, max)
      return { docs: rows.map(([id]) => snapshot(name, id)) }
    },
  })
  const db = {
    collection: (name: string) => ({
      doc: (id?: string) => ref(name, id ?? `auto${++auto}`),
      where: (field: string, op: string, value: unknown) => query(name, [], null, null).where(field, op, value),
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => query(name, [], null, null).orderBy(field, dir),
      limit: (n: number) => query(name, [], null, null).limit(n),
      get: async () => query(name, [], null, null).get(),
    }),
    // Writes apply only when the callback returns, as a committed transaction's do.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const writes: (() => void)[] = []
      const tx = {
        get: (r: { get(): Promise<unknown> }) => r.get(),
        set: (r: { collectionName: string; id: string }, data: Data) => { writes.push(() => coll(r.collectionName).set(r.id, structuredClone(data))) },
        delete: (r: { collectionName: string; id: string }) => { writes.push(() => coll(r.collectionName).delete(r.id)) },
      }
      const out = await fn(tx)
      for (const w of writes) w()
      return out
    },
    batch: () => {
      const ops: (() => void)[] = []
      return {
        set: (r: { collectionName: string; id: string }, data: Data) => { ops.push(() => coll(r.collectionName).set(r.id, structuredClone(data))) },
        delete: (r: { collectionName: string; id: string }) => { ops.push(() => coll(r.collectionName).delete(r.id)) },
        commit: async () => { for (const op of ops) op() },
      }
    },
  }
  return {
    db: db as unknown as Firestore,
    seed(name: string, records: Record<string, object>) {
      for (const [id, d] of Object.entries(records)) coll(name).set(id, structuredClone(d as Data))
    },
    raw(name: string, id: string): Data | undefined {
      const d = coll(name).get(id)
      return d === undefined ? undefined : structuredClone(d)
    },
    all(name: string): Record<string, Data> {
      return Object.fromEntries([...coll(name).entries()].map(([id, d]) => [id, structuredClone(d)]))
    },
  }
}
