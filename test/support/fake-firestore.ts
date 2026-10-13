import type { Firestore } from 'firebase-admin/firestore'

// An in-memory stand-in for the slice of the Firestore Admin API the store uses: collections of
// documents, where() with ==, < and >, orderBy(), limit(), whole-collection reads, transactions
// and batches. Every write stores a deep copy and every read hands one back, so a store that edits
// what it read and forgets to write it is caught rather than hidden. Two differences from a naive
// stand-in are kept on purpose because production has them: a transaction whose reads changed
// before it committed is run again from the start (up to 5 attempts), and a write that carries an
// undefined value anywhere is refused.
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

const MAX_ATTEMPTS = 5

// Firestore refuses undefined unless ignoreUndefinedProperties is set, and the store must not rely on it.
function assertDefined(value: unknown, path: string): void {
  if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}")`)
  if (Array.isArray(value)) value.forEach((v, i) => assertDefined(v, `${path}[${i}]`))
  else if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [k, v] of Object.entries(value)) assertDefined(v, path ? `${path}.${k}` : k)
  }
}
const checked = (data: Data): Data => { assertDefined(data, ''); return data }

export function fakeFirestore() {
  const collections = new Map<string, Map<string, Data>>()
  // One counter per document, bumped by every write and delete. A transaction commits only if each
  // document it read still has the version it saw.
  const versions = new Map<string, number>()
  const versionOf = (name: string, id: string) => versions.get(`${name}/${id}`) ?? 0
  const bump = (name: string, id: string) => versions.set(`${name}/${id}`, versionOf(name, id) + 1)
  const put = (name: string, id: string, data: Data) => { coll(name).set(id, structuredClone(checked(data))); bump(name, id) }
  const drop = (name: string, id: string) => { coll(name).delete(id); bump(name, id) }
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
    set: async (data: Data) => { put(name, id, data) },
    delete: async () => { drop(name, id) },
    // Firestore's create-once: refused when the document exists. No await before the check, so two
    // overlapping callers can never both create.
    create: async (data: Data) => {
      if (coll(name).has(id)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      put(name, id, data)
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
    // Writes apply only at commit. If a document the callback read changed in the meantime, the
    // whole callback runs again from the start, as Firestore does; after 5 attempts it rejects.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      for (let attempt = 1; ; attempt++) {
        const writes: (() => void)[] = []
        const read = new Map<string, { name: string; id: string; version: number }>()
        const tx = {
          get: async (r: { collectionName: string; id: string }) => {
            const key = `${r.collectionName}/${r.id}`
            const snap = snapshot(r.collectionName, r.id)
            if (!read.has(key)) read.set(key, { name: r.collectionName, id: r.id, version: versionOf(r.collectionName, r.id) })
            return snap
          },
          set: (r: { collectionName: string; id: string }, data: Data) => { checked(data); writes.push(() => put(r.collectionName, r.id, data)) },
          delete: (r: { collectionName: string; id: string }) => { writes.push(() => drop(r.collectionName, r.id)) },
        }
        const out = await fn(tx)
        // No await between the check and the writes, so nothing can slip in between them.
        const stale = [...read.values()].some((x) => versionOf(x.name, x.id) !== x.version)
        if (!stale) {
          for (const w of writes) w()
          return out
        }
        if (attempt >= MAX_ATTEMPTS) throw Object.assign(new Error('ABORTED: too much contention on these documents'), { code: 10 })
      }
    },
    batch: () => {
      const ops: (() => void)[] = []
      return {
        set: (r: { collectionName: string; id: string }, data: Data) => { checked(data); ops.push(() => put(r.collectionName, r.id, data)) },
        delete: (r: { collectionName: string; id: string }) => { ops.push(() => drop(r.collectionName, r.id)) },
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
