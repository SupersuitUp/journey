import { isRuleError } from '../errors.js'

// A refusal answers with its own status only when that status is a client error (400-499). One
// carrying any other status (a 200, a 500, nothing a Response accepts) is a host bug, and is
// answered as one: logged, opaque 500. A refusal with no status answers 403.
function refusalStatus(status: unknown): number | null {
  if (status === undefined) return 403
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 499 ? status : null
}

// Every route answers in one shape: a refusal's own words and status (with whatever this package's
// own refusal carries beside them), an unreadable body as 400, anything else as an opaque 500 that
// is logged here and never shown to the caller. What counts as a refusal is decided by `isRefusal`
// (the handlers pass the package's own RuleError OR the host's check), so an error is never shown
// merely because it carries a 4xx status.
export async function handle(fn: () => Promise<Response>, isRefusal: (err: unknown) => boolean = isRuleError): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (isRefusal(err)) {
      const { message, status } = err as { message: string; status?: unknown }
      const code = refusalStatus(status)
      if (code !== null) return Response.json({ ...(isRuleError(err) ? err.extra : undefined), error: message }, { status: code })
    }
    // req.json() throws a SyntaxError on an unparsable body.
    else if (err instanceof SyntaxError) return Response.json({ error: 'bad request' }, { status: 400 })
    console.error(err)
    return Response.json({ error: 'something went wrong' }, { status: 500 })
  }
}
