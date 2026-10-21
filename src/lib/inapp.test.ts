import { describe, expect, it } from 'vitest'
import { externalUrl, inAppBrowser } from './inapp'

const FB_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]'
const IG_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0'
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

describe('in-app browsers', () => {
  it('spots Facebook and Instagram but not Safari', () => {
    expect(inAppBrowser(FB_ANDROID)).toBe(true)
    expect(inAppBrowser(IG_IOS)).toBe(true)
    expect(inAppBrowser(SAFARI)).toBe(false)
  })
  it('keeps the Drive link when handing over to the real browser', () => {
    const href = 'https://msyazz.github.io/singitnow/?drive=abc123'
    expect(externalUrl(href, FB_ANDROID)).toBe(
      'intent://msyazz.github.io/singitnow/?drive=abc123#Intent;scheme=https;S.browser_fallback_url=https%3A%2F%2Fmsyazz.github.io%2Fsingitnow%2F%3Fdrive%3Dabc123;end',
    )
    expect(externalUrl(href, IG_IOS)).toBe('x-safari-https://msyazz.github.io/singitnow/?drive=abc123')
  })
})
