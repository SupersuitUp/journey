export interface JourneyClientConfig {
  /** Where the app mounted the member handlers: the list is <apiBase>/days, a day is <apiBase>/days/<day>. */
  apiBase: string
  /** Where the Journey pages live: the list at <pageBase>, a day at <pageBase>/<day>. */
  pageBase: string
}
