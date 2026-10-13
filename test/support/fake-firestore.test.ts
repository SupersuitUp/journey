// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeFirestore } from './fake-firestore.js'

const gate = () => {
  let open!: () => void
  const wait = new Promise<void>((r) => { open = r })
  return { wait, open }
}

describe('the fake Firestore behaves like the real one where the store depends on it', () => {
  it('runs a transaction again when a document it read changed before it committed', async () => {
    const { db, seed, raw } = fakeFirestore()
    seed('c', { d: { n: 0 } })
    const ref = db.collection('c').doc('d')
    const slow = gate()
    const seen: number[] = []
    const first = db.runTransaction(async (tx) => {
      const n = (await tx.get(ref)).data()!.n as number
      seen.push(n)
      if (seen.length === 1) await slow.wait
      tx.set(ref, { n: n + 1 })
    })
    const second = db.runTransaction(async (tx) => {
      const n = (await tx.get(ref)).data()!.n as number
      tx.set(ref, { n: n + 10 })
    })
    await second
    slow.open()
    await first
    expect(seen).toEqual([0, 10])
    expect(raw('c', 'd')).toEqual({ n: 11 })
  })

  it('applies a transaction\'s writes only when it commits', async () => {
    const { db, seed, raw } = fakeFirestore()
    seed('c', { d: { n: 0 } })
    const ref = db.collection('c').doc('d')
    const hold = gate()
    const tx = db.runTransaction(async (t) => { t.set(ref, { n: 1 }); await hold.wait })
    await Promise.resolve()
    expect(raw('c', 'd')).toEqual({ n: 0 })
    hold.open()
    await tx
    expect(raw('c', 'd')).toEqual({ n: 1 })
  })

  it('rejects after 5 attempts when the document keeps changing', async () => {
    const { db, seed } = fakeFirestore()
    seed('c', { d: { n: 0 } })
    const ref = db.collection('c').doc('d')
    let runs = 0
    await expect(db.runTransaction(async (tx) => {
      await tx.get(ref)
      runs++
      await ref.set({ n: runs })
    })).rejects.toThrow(/contention/)
    expect(runs).toBe(5)
  })

  it('does not re-run a transaction for a document it never read', async () => {
    const { db, seed } = fakeFirestore()
    seed('c', { a: { n: 0 }, b: { n: 0 } })
    let runs = 0
    await db.runTransaction(async (tx) => {
      runs++
      await tx.get(db.collection('c').doc('a'))
      await db.collection('c').doc('b').set({ n: 1 })
    })
    expect(runs).toBe(1)
  })

  it('refuses a set, a create and a batch write that carry an undefined value, naming the field', async () => {
    const { db } = fakeFirestore()
    const ref = db.collection('c').doc('d')
    await expect(ref.set({ a: { b: [1, { c: undefined }] } })).rejects.toThrow('a.b[1].c')
    await expect(ref.create({ top: undefined })).rejects.toThrow('"top"')
    expect(() => db.batch().set(ref, { x: { y: undefined } })).toThrow('x.y')
    await expect(db.runTransaction(async (tx) => { tx.set(ref, { z: undefined }) })).rejects.toThrow('"z"')
    expect((await ref.get()).exists).toBe(false)
  })
})
