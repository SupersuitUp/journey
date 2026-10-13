import type { NextConfig } from 'next'

// The consumer sits inside the package's repository; its own folder is the root Turbopack builds
// from, so the package is resolved from test/consumer/node_modules exactly as an app would.
const config: NextConfig = { turbopack: { root: process.cwd() } }
export default config
