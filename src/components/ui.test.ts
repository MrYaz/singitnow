import { describe, expect, it } from 'vitest'
import { othersVoices } from './ui'

describe('othersVoices', () => {
  it('names the voices from the PDF labels', () => {
    expect(othersVoices(['Sop: I was so lonesome', 'I could not help it'])).toEqual(['Sopraner'])
    expect(othersVoices(['Alt1: hey', 'Sop: ho', 'Alt 1: hey'])).toEqual(['Alt 1', 'Sopraner'])
    expect(othersVoices(['no label here'])).toEqual([])
  })
})
