import 'server-only'
import { RuleError, isRuleError } from '../errors.js'
import type { JourneyHost } from './host.js'
import { handle as handleWith } from './http.js'
import { createJourneyStore, type JourneyStore } from './store.js'

type DayParams = { params: Promise<{ day: string }> }

// The handlers an app mounts at its own addresses, one line per route file. Each route file still
// declares its own segment config (`runtime = 'nodejs'`), because Next.js reads that from the
// route file itself. Two doors, never mixed: a member route asks the session and nothing else; an
// agent route asks the agent key and nothing else.
export function createJourneyHandlers<M extends string>(host: JourneyHost<M>, store: JourneyStore<M> = createJourneyStore(host)) {
  // The host's own refusals ADD to the package's: a RuleError always reaches the caller with its words.
  const handle = (fn: () => Promise<Response>) => handleWith(fn, (err) => isRuleError(err) || host.isRefusal?.(err) === true)
  const signedIn = async (req?: Request): Promise<M> => {
    const m = await host.member(req)
    if (!m) throw new RuleError('private', 403)
    return m
  }
  const asAgent = async (req: Request): Promise<M> => {
    const m = host.agent ? await host.agent.member(req) : null
    if (!m) throw new RuleError('agent key required', 401)
    return m
  }
  const query = (req: Request) => new URL(req.url).searchParams
  const keyOf = (req: Request): string => {
    const key = query(req).get('key')
    if (!key) throw new RuleError('key is required', 400)
    return key
  }

  return {
    // The list: days, newest first. `?before=<day>` is the cursor the last page handed back.
    days: {
      GET: (req: Request) => handle(async () => {
        await signedIn(req)
        const q = query(req)
        return Response.json(await store.listDays({ before: q.get('before') ?? undefined, limit: q.get('limit') ?? undefined }))
      }),
    },
    // One day's page.
    day: {
      GET: (req: Request, { params }: DayParams) => handle(async () => {
        await signedIn(req)
        const view = await store.getDay((await params).day)
        if (!view) return Response.json({ error: 'not found' }, { status: 404 })
        return Response.json(view)
      }),
    },
    // `?key=<item key>`. DELETE removes (hides), POST restores. Either member, any item.
    item: {
      DELETE: (req: Request, { params }: DayParams) => handle(async () => {
        const m = await signedIn(req)
        return Response.json(await store.remove(m, (await params).day, keyOf(req)))
      }),
      POST: (req: Request, { params }: DayParams) => handle(async () => {
        const m = await signedIn(req)
        return Response.json(await store.restore(m, (await params).day, keyOf(req)))
      }),
    },
    // What was removed from a day: title and kind only, with who removed it and when.
    removed: {
      GET: (req: Request, { params }: DayParams) => handle(async () => {
        await signedIn(req)
        return Response.json({ removed: await store.removed((await params).day) })
      }),
    },
    // A machine's door. The app vouches for the request with its own agent key through
    // host.agent.member; the session is never read here. Each key acts as exactly one member.
    agent: {
      // Body: { kind: 'photo' } or { kind: 'video', contentType, size }. The app's own upload
      // ticket, handed back with the id the item will name as media.uploadId.
      ticket: {
        POST: (req: Request) => handle(async () => {
          const m = await asAgent(req)
          const b = ((await req.json()) ?? {}) as { kind?: unknown; contentType?: unknown; size?: unknown }
          if (b.kind === 'photo') {
            const t = await host.agent!.photoTicket(m)
            return Response.json({ uploadId: t.photoId, url: t.url, headers: t.headers ?? {} })
          }
          if (b.kind === 'video') {
            const t = await host.agent!.videoTicket(m, { contentType: b.contentType, size: b.size })
            return Response.json({ uploadId: t.photoId, videoUrl: t.videoUrl, posterUrl: t.posterUrl, requiredHeaders: t.requiredHeaders })
          }
          throw new RuleError('kind must be photo or video', 400)
        }),
      },
      // Body: { items: [...] }, up to sixty items for this one day. Safe to send again. One row comes
      // back per item, in order, and one item that cannot be kept never refuses the rest.
      items: {
        POST: (req: Request, { params }: DayParams) => handle(async () => {
          const m = await asAgent(req)
          return Response.json(await store.contribute(m, (await params).day, await req.json()))
        }),
      },
      // The day as the session that writes its account reads it.
      day: {
        GET: (req: Request, { params }: DayParams) => handle(async () => {
          await asAgent(req)
          return Response.json(await store.agentDay((await params).day))
        }),
      },
      // Body: { text, basedOn }. `basedOn` is the hash day.GET gave.
      account: {
        PUT: (req: Request, { params }: DayParams) => handle(async () => {
          const m = await asAgent(req)
          return Response.json(await store.setAccount(m, (await params).day, await req.json()))
        }),
      },
    },
  }
}

export type JourneyHandlers<M extends string> = ReturnType<typeof createJourneyHandlers<M>>
