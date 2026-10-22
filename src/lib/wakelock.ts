/** Keeps the screen on until the returned function is called. Phones pause web pages when the screen
 *  turns off, so long jobs like an import hold this. Takes the lock again when the page comes back. */
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null
  let done = false
  const take = async () => {
    if (done || document.visibilityState !== 'visible' || (lock && !lock.released)) return
    try {
      lock = (await navigator.wakeLock?.request('screen')) ?? null
      if (done) void lock?.release()
    } catch {
      /* not supported, or low battery mode */
    }
  }
  void take()
  document.addEventListener('visibilitychange', take)
  return () => {
    done = true
    document.removeEventListener('visibilitychange', take)
    void lock?.release()
  }
}
