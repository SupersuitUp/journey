#!/usr/bin/env node
// Break each guard on purpose and confirm the tests notice. A guard that can be removed without
// a red test is a guard nobody is checking. Each mutant runs only the test files named for it.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const MUTATIONS = [
  {
    file: 'src/day.ts', tests: ['src/day.test.ts'], why: 'a removed key is refused when it is contributed again',
    find: "if (known?.removed) return still(rec, { key: item.key, status: 'refused', reason: REMOVED_REASON })", replace: '',
  },
  {
    file: 'src/day.ts', tests: ['src/day.test.ts'], why: 'contributing the same key again changes nothing',
    find: "if (known) return still(rec, { key: item.key, status: 'present' })", replace: '',
  },
  {
    file: 'src/day.ts', tests: ['src/day.test.ts'], why: 'the same call removed under one key is refused under another',
    find: 'if (twin?.removed) return refuseTwin(rec, twin, item, now)', replace: '',
  },
  {
    file: 'src/day.ts', tests: ['src/day.test.ts', 'src/server/owed-forget.test.ts'], why: 'the refused second recording of a removed call still narrows it when it says others were present',
    find: 'if (twin?.removed) return refuseTwin(rec, twin, item, now)', replace: "if (twin?.removed) return still(rec, { key: item.key, status: 'refused', reason: REMOVED_REASON })",
  },
  {
    file: 'src/day.ts', tests: ['src/day.test.ts', 'src/server/owed-forget.test.ts'], why: 'a narrowing marks the item as owing search a forget',
    find: 'const out: Item<M> = { ...item, others: true, owesForget: now }', replace: 'const out: Item<M> = { ...item, others: true }',
  },
  {
    file: 'src/day.ts', tests: ['src/day.test.ts', 'src/server/owed-forget.test.ts'], why: 'a narrowing on a day with an account marks the account as owing a forget too',
    find: 'if (rec.account !== undefined) next.accountOwesForget = now', replace: '',
  },
  {
    file: 'src/day.ts', tests: ['src/day.test.ts', 'src/server/caps.test.ts'], why: 'a call takes no more than eight other keys',
    find: 'if (crowded(twin)) {', replace: 'if (false) {',
  },
  {
    file: 'src/removal.ts', tests: ['src/removal.test.ts', 'src/server/owed-forget.test.ts'], why: 'a removal marks the item as owing search a forget',
    find: 'removed: { by: m, at: now }, owesForget: now }', replace: 'removed: { by: m, at: now } }',
  },
  {
    file: 'src/forget.ts', tests: ['src/forget.test.ts'], why: 'confirming an older debt never clears a newer one',
    find: 'if (!item || item.owesForget !== p.stamp) continue', replace: 'if (!item) continue',
  },
  {
    file: 'src/item-rules.ts', tests: ['src/item-rules.test.ts', 'src/server/contribute.test.ts'], why: 'a key that breaks the rule fails its own item and not the call',
    find: "    try {\n      return { key, item: validateItem(raw, day, timeZone) }", replace: "    validateKey(given)\n    try {\n      return { key, item: validateItem(raw, day, timeZone) }",
  },
  {
    file: 'src/item-rules.ts', tests: ['src/item-rules.test.ts'], why: 'a key holds no control character',
    find: 'CONTROL_RE.test(v) || ', replace: '',
  },
  {
    file: 'src/item-rules.ts', tests: ['src/item-rules.test.ts'], why: 'a key is never of the form the database keeps for itself',
    find: ' || RESERVED_RE.test(v)', replace: '',
  },
  {
    file: 'src/day.ts', tests: ['src/day.test.ts'], why: 'a merge marks a written account stale',
    find: 'next.accountStale = true\n    if (narrowed)', replace: 'if (narrowed)',
  },
  {
    file: 'src/day.ts', tests: ['src/day.test.ts'], why: 'a merge that strips what the account told of withholds the account',
    find: 'if (narrowed) next.accountWithheld = true', replace: '',
  },
  {
    file: 'src/item-rules.ts', tests: ['src/item-rules.test.ts'], why: 'a call with other people present carries no media',
    find: "if (others && media) throw new RuleError('a call with other people present carries no recording', 400)", replace: '',
  },
  {
    file: 'src/item-rules.ts', tests: ['src/item-rules.test.ts'], why: 'a call with other people present carries no summary',
    find: "if (others && summary) throw new RuleError('a call with other people present carries no summary, only a title and one line', 400)", replace: '',
  },
  {
    file: 'src/item-rules.ts', tests: ['src/item-rules.test.ts'], why: 'an item belongs to the day its time falls on in the host zone',
    find: 'if (dayIn(at, timeZone) !== day) throw new RuleError(`at does not fall on ${day} in ${timeZone}`, 400)', replace: '',
  },
  {
    file: 'src/account-rules.ts', tests: ['src/account-rules.test.ts'], why: 'an account written from a day that has since changed is refused',
    find: "if (basedOn !== hash) throw new RuleError('the day changed since it was read', 409, { hash })", replace: '',
  },
  {
    file: 'src/account-rules.ts', tests: ['src/account-rules.test.ts'], why: 'only the first account a day ever gets is the first',
    find: 'const first = rec.account === undefined', replace: 'const first = true',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/remove-account.test.ts'], why: 'the day-written announcement fires only the first time',
    find: "if (out.first) await settle('announce dayWritten'", replace: "await settle('announce dayWritten'",
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/remove-account.test.ts'], why: 'the day-written announcement is waited for before the write answers',
    find: "if (out.first) await settle('announce dayWritten'", replace: "if (out.first) void settle('announce dayWritten'",
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/remove-account.test.ts'], why: 'search forgets a removed item before the request answers',
    find: "await settle('forget item', () => host.forget?.item(day, o.key))", replace: 'true',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/owed-forget.test.ts'], why: 'a removal, a restore and an account each retry what the day already owes search',
    find: 'return seen.exists ? pay(day, owedOf(seen.data() as DayRecord<M>), NOTHING_PAID, keep) : NOTHING_PAID', replace: 'return NOTHING_PAID',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/owed-forget.test.ts'], why: 'a contribution retries what the day already owes search before anything else can stop it',
    find: 'const first = await pay(day, owedOf(before))', replace: 'const first = NOTHING_PAID',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/owed-forget.test.ts', 'src/server/contribute.test.ts'], why: 'a forget search confirmed is struck off the day',
    find: 'if (next !== had) tx.set(ref, { ...next })', replace: '',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/owed-forget.test.ts', 'src/server/contribute.test.ts'], why: 'an item that still owes a forget is never indexed by a contribution',
    find: ' || stillOwes(out.owed, paid, t.key)) continue', replace: ') continue',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/owed-forget.test.ts'], why: 'a restored item that still owes a forget is not indexed',
    find: 'if (out.changed && !out.owes) quietly(', replace: 'if (out.changed) quietly(',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/owed-forget.test.ts'], why: 'an account that still owes a forget is not indexed',
    find: "if (!out.owes) quietly('index day'", replace: "quietly('index day'",
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/owed-forget.test.ts'], why: 'the removal 409 says the item is removed',
    find: 'throw new RuleError(NOT_FORGOTTEN, 409, { removed: true })', replace: 'throw new RuleError(NOT_FORGOTTEN, 409)',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/caps.test.ts'], why: 'an item that would take the day past the size of a record is left out',
    find: 'if (step.rec !== rec && !step.narrowed && dayBytes(step.rec) > DAY_MAX_BYTES) {', replace: 'if (false) {',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/caps.test.ts'], why: 'a narrowing is never held back by the size of the day',
    find: 'if (step.rec !== rec && !step.narrowed && dayBytes(step.rec) > DAY_MAX_BYTES) {', replace: 'if (step.rec !== rec && dayBytes(step.rec) > DAY_MAX_BYTES) {',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/contribute.test.ts'], why: 'an upload the pipeline cannot process fails its own item and not the call',
    find: "        failed('file media', err)\n        throw new RuleError(UNREADABLE, 400)", replace: '        throw err',
  },
  {
    file: 'src/views.ts', tests: ['src/views.test.ts', 'src/server/reads.test.ts', 'src/server/leaks.test.ts'], why: 'searchDay leaves out removed items',
    find: 'const items = visibleOf(rec).filter((i) => i.owesForget === undefined).map(', replace: 'const items = Object.values(rec.items).filter((i) => i.owesForget === undefined).map(',
  },
  {
    file: 'src/views.ts', tests: ['src/views.test.ts', 'src/server/reads.test.ts'], why: 'searchDay leaves out an item that still owes a forget',
    find: 'const items = visibleOf(rec).filter((i) => i.owesForget === undefined).map(', replace: 'const items = visibleOf(rec).map(',
  },
  {
    file: 'src/views.ts', tests: ['src/views.test.ts', 'src/server/leaks.test.ts'], why: 'searchDay leaves out a withheld account',
    find: 'const shown = rec.account && !rec.accountWithheld && rec.accountOwesForget === undefined', replace: 'const shown = rec.account && rec.accountOwesForget === undefined',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/owed-forget.test.ts'], why: 'a forget paid before the removal does not count',
    find: 'const itemGone = second.items.has(out.key) ||', replace: 'const itemGone = first.items.has(out.key) || second.items.has(out.key) ||',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/owed-forget.test.ts'], why: 'the removal never indexes the item it is removing',
    find: 'if (o.key === keep) continue', replace: '',
  },
  {
    file: 'src/server/store.ts', tests: ['src/server/remove-account.test.ts'], why: 'a removal whose forget failed answers an error, so the person tries again',
    find: 'if (!itemGone || !dayGone) throw new RuleError(NOT_FORGOTTEN, 409, { removed: true })', replace: '',
  },
  {
    file: 'src/server/handlers.ts', tests: ['src/server/handlers.test.ts'], why: 'an agent route never accepts a session',
    find: 'const m = host.agent ? await host.agent.member(req) : null', replace: 'const m = (host.agent ? await host.agent.member(req) : null) ?? (await host.member(req))',
  },
  {
    file: 'src/server/handlers.ts', tests: ['src/server/handlers.test.ts'], why: 'a member route never accepts an agent key',
    find: 'const m = await host.member(req)', replace: 'const m = (await host.member(req)) ?? (host.agent ? await host.agent.member(req) : null)',
  },
  {
    file: 'src/day-hash.ts', tests: ['src/day-hash.test.ts'], why: 'removed items are left out of the hash',
    find: '.filter((it) => !it.removed)', replace: '',
  },
  {
    file: 'src/day-hash.ts', tests: ['src/day-hash.test.ts'], why: 'the hash covers who contributed each item',
    find: ' [...it.by].sort(),', replace: '',
  },
  {
    file: 'src/removal.ts', tests: ['src/removal.test.ts', 'src/views.test.ts'], why: 'removed items are left out of every read',
    find: '.filter((i) => !i.removed).sort(byTime)', replace: '.sort(byTime)',
  },
  {
    file: 'src/client/journey-day.tsx', tests: ['src/client/journey-day.test.tsx'], why: 'Remove asks once and sends nothing until it is confirmed',
    find: 'onAsk={() => { setRowNote(null); setConfirmKey(item.key) }}', replace: 'onAsk={() => { void remove(item.key) }}',
  },
  {
    file: 'src/client/journey-day.tsx', tests: ['src/client/journey-day.test.tsx'], why: 'Yes, remove is disabled while its request is on the way',
    find: '<button type="button" onClick={onRemove} disabled={busy} aria-label', replace: '<button type="button" onClick={onRemove} aria-label',
  },
  {
    file: 'src/client/journey-day.tsx', tests: ['src/client/journey-day.test.tsx'], why: 'a 409 that says removed is shown as a removal that happened',
    find: 'const anyway = refused !== null && res.status === 409 && refused.removed', replace: 'const anyway = false as boolean',
  },
  {
    file: 'src/client/journey-day.tsx', tests: ['src/client/journey-day.test.tsx'], why: 'a removal that went through is taken off the page even when the day cannot be read again',
    find: 'if (!fresh) setView((had) => without(had, key, count))', replace: '',
  },
  {
    file: 'src/client/journey-day.tsx', tests: ['src/client/journey-day.test.tsx'], why: 'focus moves to Keep when Remove asks its question',
    find: 'if (confirming) keepRef.current?.focus()\n    else if', replace: 'if',
  },
  {
    file: 'src/client/provider.tsx', tests: ['src/client/provider.test.tsx'], why: 'the look an app sets reaches the screens under its provider',
    find: 'const look = JSON.stringify(themeWith(theme))', replace: 'const look = JSON.stringify(themeWith(undefined))',
  },
]

// A mutant can hang the tests it breaks, so each run has a deadline, and running out of time
// counts as the tests noticing.
const TIMEOUT_MS = 180_000
let mutated = null // the file currently broken on purpose, and what it said before
let child = null

function restore() {
  if (mutated) writeFileSync(mutated.path, mutated.original)
  mutated = null
}
const stopTests = () => { try { if (child) process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ } }

// An interrupted check must not leave a broken guard in the working tree.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopTests(); restore(); process.exit(130) })

// Its own process group, so the deadline takes the test runner's children with it.
function runTests(files) {
  return new Promise((done) => {
    let late = false
    child = spawn('npx', ['vitest', 'run', ...files], { cwd: root, stdio: 'ignore', detached: true })
    const timer = setTimeout(() => { late = true; stopTests() }, TIMEOUT_MS)
    child.on('error', () => { clearTimeout(timer); child = null; done('error') })
    child.on('close', (code) => { clearTimeout(timer); child = null; done(late ? 'timeout' : code) })
  })
}

let survived = 0
for (const m of MUTATIONS) {
  const path = join(root, m.file)
  const original = readFileSync(path, 'utf8')
  if (!original.includes(m.find)) { console.log(`STALE     ${m.why}: the guard text was not found in ${m.file}`); survived++; continue }
  let outcome
  try {
    mutated = { path, original }
    writeFileSync(path, original.replace(m.find, () => m.replace))
    outcome = await runTests(m.tests)
  } finally { restore() }
  if (outcome === 0 || outcome === 'error') { console.log(`SURVIVED  ${m.why}`); survived++ }
  else console.log(`caught    ${m.why}${outcome === 'timeout' ? ' (the tests ran out of time)' : ''}`)
}
if (survived) { console.log(`${survived} guard(s) are not protected by a test`); process.exit(1) }
console.log(`all ${MUTATIONS.length} guards are protected`)
