// The root entry: types, the refusal, the validators, the formatters, the statuses and the caps.
// Everything here is plain and loads anywhere (a server page, a script, an outlet that sends items).
// Each name is listed on purpose; the rules that decide how a day works stay inside the package.
export { RuleError, isRuleError, type RuleStatus } from './errors.js'
export type {
  Account, AgentDay, AgentItem, ContributeAnswer, ContributeResult, ContributeStatus, DayGroup, DayRecord, DayRow, DaysPage, DayView,
  FiledMedia, GroupName, Item, ItemKind, ItemMedia, ItemView, MediaKind, MediaRecord, MediaView, Member, MemberNames, NewItem, NewMedia,
  Outcome, Removal, RemovedRow, SearchDay, SearchItem, VideoContentType, VideoInfo,
} from './types.js'
export { DAYS_PAGE_DEFAULT, DAYS_PAGE_MAX, dayIn, validateAt, validateDay } from './day-rules.js'
export {
  AKA_MAX, DAY_MAX_ITEMS, ITEMS_PER_CALL, ITEM_KINDS, KEY_MAX, LINE_MAX, SCENE_MAX, SUMMARY_MAX, TITLE_MAX, TRANSCRIPT_MAX, VIDEO_MAX_DURATION_SEC, WORDS_MAX, validateKey,
} from './item-rules.js'
export { CONTRIBUTE_STATUSES, DAY_MAX_BYTES } from './day.js'
export { ACCOUNT_MAX } from './account-rules.js'
export { THUMBS_PER_DAY } from './views.js'
export { formatDay, formatWhen, fromLine } from './format.js'
