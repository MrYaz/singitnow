/** Social apps (Facebook, Instagram, Messenger, TikTok …) open links in their own small browser,
 *  where saved songs vanish and audio is unreliable. These helpers send the visitor on to the real browser. */

const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|MessengerForiOS|Snapchat|musical_ly|BytedanceWebview|TikTok|LinkedInApp|Line\/|Pinterest|Threads/i

export function inAppBrowser(ua = navigator.userAgent): boolean {
  return IN_APP.test(ua)
}

export const isAndroid = (ua = navigator.userAgent) => /Android/i.test(ua)
export const isIOS = (ua = navigator.userAgent) => /iPhone|iPad|iPod/i.test(ua)

/** A link that asks the phone to open this address in its normal browser. */
export function externalUrl(href: string, ua = navigator.userAgent): string {
  const u = new URL(href)
  if (isAndroid(ua)) return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=https;S.browser_fallback_url=${encodeURIComponent(href)};end`
  // iOS 17 and later open Safari for this scheme; older versions ignore it and the instructions are shown instead.
  if (isIOS(ua)) return `x-safari-${href}`
  return href
}
