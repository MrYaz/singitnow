import { describe, expect, it } from 'vitest'
import { withName } from './cheer'

describe('withName', () => {
  it('adds the name every other time', () => {
    expect(withName('Snyggt!', 'Ella', 0)).toBe('Snyggt, Ella!')
    expect(withName('Snyggt!', 'Ella', 1)).toBe('Snyggt!')
    expect(withName('Så ska det låta!', 'Ella', 2)).toBe('Så ska det låta, Ella!')
    expect(withName('Fint!', '', 0)).toBe('Fint!')
  })
})
