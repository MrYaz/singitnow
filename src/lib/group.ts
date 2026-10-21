import { classify, normalize, similarity, slug, songNameFromFile } from './names'
import type { SourceFile } from './sources'
import type { TrackKind } from './types'

export interface GroupedFile {
  file: SourceFile
  kind: TrackKind
  voice?: string
}

export interface SongGroup {
  id: string
  folder: string
  order: number
  files: GroupedFile[]
}

const folderTitle = (f: string) => f.replace(/^\s*\d+\s*[.)]\s*/, '').replace(/_n_/g, "'n'").trim()
const folderOrder = (f: string) => Number(f.match(/^\s*(\d+)/)?.[1] ?? 999)

/**
 * Groups files into songs. With folders (Drive or a picked folder) a song is the
 * folder that holds a "Musik" file; without folders we match on the file names.
 */
export function groupSongs(files: SourceFile[]): SongGroup[] {
  const known = files
    .map((file) => ({ file, c: classify(file.name) }))
    .filter((x): x is { file: SourceFile; c: NonNullable<ReturnType<typeof classify>> } => !!x.c)
    .map(({ file, c }) => ({ file, kind: c.kind, voice: c.voice }))

  const musik = known.filter((g) => g.kind === 'musik')
  const groups: SongGroup[] = []
  const withFolders = musik.length > 0 && musik.every((m) => m.file.path.length > 0)

  if (withFolders) {
    for (const m of musik) {
      const dir = m.file.path
      const key = dir.join('/')
      const folder = dir.at(-1)!
      const inside = known.filter((g) => g.file.path.join('/').startsWith(key) && g.file.path.length >= dir.length)
      groups.push({ id: slug(folderTitle(folder)), folder, order: folderOrder(folder), files: inside })
    }
    return groups.sort((a, b) => a.order - b.order || a.folder.localeCompare(b.folder))
  }

  // Flat list: group audio by song name, then attach each PDF to the closest song.
  const byName = new Map<string, SongGroup>()
  for (const g of known.filter((g) => g.kind !== 'pdf')) {
    const name = songNameFromFile(g.file.name)
    const key = normalize(name)
    let grp = byName.get(key)
    if (!grp) {
      grp = { id: slug(name), folder: name, order: 999, files: [] }
      byName.set(key, grp)
    }
    grp.files.push(g)
  }
  const list = [...byName.values()]
  for (const p of known.filter((g) => g.kind === 'pdf')) {
    const name = songNameFromFile(p.file.name)
    let best: SongGroup | null = null
    let score = 0
    for (const grp of list) {
      const s = similarity(name, grp.folder)
      if (s > score) {
        score = s
        best = grp
      }
    }
    if (best && score > 0.5) best.files.push(p)
  }
  return list.filter((g) => g.files.some((f) => f.kind === 'musik'))
}

export { folderTitle }
