import { describe, expect, it } from 'vitest'
import { RuleError, isRuleError } from './errors.js'

describe('RuleError', () => {
  it('carries its words, its status and anything extra the answer should hold', () => {
    const err = new RuleError('the day changed since it was read', 409, { hash: 'abc' })
    expect(err.message).toBe('the day changed since it was read')
    expect(err.status).toBe(409)
    expect(err.extra).toEqual({ hash: 'abc' })
    expect(err).toBeInstanceOf(Error)
  })

  it('is a 403 with nothing extra unless told otherwise', () => {
    const err = new RuleError('private')
    expect(err.status).toBe(403)
    expect(err.extra).toBeUndefined()
  })

  it('is recognised as this package own refusal, and nothing else is', () => {
    expect(isRuleError(new RuleError('no'))).toBe(true)
    expect(isRuleError(new Error('no'))).toBe(false)
    expect(isRuleError({ message: 'no', status: 403 })).toBe(false)
    expect(isRuleError(null)).toBe(false)
  })
})
