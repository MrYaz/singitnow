/** Adds your name to a cheer now and then, e.g. "Snyggt, Ella!". */
export function withName(text: string, name: string, seed: number): string {
  const n = name.trim()
  if (!n || seed % 2) return text
  const m = text.match(/^(.*?)([!.]?)(\s*\p{Extended_Pictographic}*)$/u)
  if (!m) return text
  return `${m[1]}, ${n}${m[2] || '!'}${m[3]}`
}
