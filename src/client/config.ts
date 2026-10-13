export interface JourneyClientConfig {
  /** Where the app mounted the member handlers: the list is <apiBase>/days, a day is <apiBase>/days/<day>. */
  apiBase: string
  /** Where the Journey pages live: the list at <pageBase>, a day at <pageBase>/<day>. */
  pageBase: string
}

let current: JourneyClientConfig | null = null

export function configure(c: JourneyClientConfig): void {
  current = c
}

export function clientConfig(): JourneyClientConfig {
  if (!current) throw new Error('Journey is not configured: render its screens inside <JourneyProvider>')
  return current
}
