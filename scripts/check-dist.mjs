#!/usr/bin/env node
// Properties of the BUILT package that no unit test can see, because the tests run the sources:
//   1. every file that starts with 'use client' in src/ still starts with it in dist/;
//   2. the server entry still refuses to load in a browser bundle (import 'server-only' first);
//   3. nothing outside dist/server/ mentions server-only, and nothing outside dist/client/ imports React,
//      so the root entry stays safe to import anywhere.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const DIST = join(ROOT, 'dist')
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const clientFirst = (text) => /^['"]use client['"]/.test(text.trimStart())
const bad = []

for (const src of walk(SRC).filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))) {
  if (!clientFirst(readFileSync(src, 'utf8'))) continue
  const out = join(DIST, relative(SRC, src)).replace(/\.tsx?$/, '.js')
  if (!clientFirst(readFileSync(out, 'utf8'))) bad.push(`${relative(ROOT, out)} lost its 'use client'`)
}
if (!/^import ['"]server-only['"];?/.test(readFileSync(join(DIST, 'server/index.js'), 'utf8').trimStart())) {
  bad.push("dist/server/index.js does not start with import 'server-only'")
}
for (const file of walk(DIST).filter((p) => p.endsWith('.js'))) {
  const rel = relative(DIST, file)
  const text = readFileSync(file, 'utf8')
  if (!rel.startsWith(`server${sep}`) && /server-only/.test(text)) bad.push(`dist/${rel} mentions server-only outside the server entry`)
  if (!rel.startsWith(`client${sep}`) && /from ['"]react(\/|['"])/.test(text)) bad.push(`dist/${rel} imports React outside the client entry`)
}
for (const b of bad) console.error(b)
if (bad.length) process.exit(1)
console.log('dist: client files keep use client, the server entry is guarded, the root entry is plain')
