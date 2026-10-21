/** A file we can import, from the device or from Google Drive. */
export interface SourceFile {
  id: string
  /** Folder names from the chosen root down to the file. */
  path: string[]
  name: string
  size: number
  modified?: string
  load: () => Promise<Blob>
}

export function fromFileList(list: FileList | File[]): SourceFile[] {
  return Array.from(list).map((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    const parts = rel.split('/')
    return {
      id: `local:${rel}:${f.size}`,
      path: parts.slice(0, -1),
      name: f.name,
      size: f.size,
      modified: new Date(f.lastModified).toISOString(),
      load: async () => f,
    }
  })
}

const API = 'https://www.googleapis.com/drive/v3/files'
export const DRIVE_KEY: string | undefined = import.meta.env.VITE_GOOGLE_API_KEY || undefined

export function driveFolderId(url: string): string | null {
  const m = url.match(/folders\/([\w-]{10,})/) ?? url.match(/[?&]id=([\w-]{10,})/) ?? url.trim().match(/^([\w-]{20,})$/)
  return m ? m[1] : null
}

interface DriveItem {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
}

async function listChildren(folderId: string, key: string): Promise<DriveItem[]> {
  const out: DriveItem[] = []
  let page: string | undefined
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`)
    const url =
      `${API}?q=${q}&key=${key}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true` +
      `&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime)` +
      (page ? `&pageToken=${page}` : '')
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text()
      throw new Error(res.status === 404 ? 'Hittar inte mappen. Är den delad som "Alla som har länken"?' : `Google Drive svarade ${res.status}: ${body.slice(0, 200)}`)
    }
    const json = (await res.json()) as { files: DriveItem[]; nextPageToken?: string }
    out.push(...json.files)
    page = json.nextPageToken
  } while (page)
  return out
}

/** Lists audio and PDF files in a public Drive folder, three levels deep. */
export async function listDriveFolder(folderUrl: string, key = DRIVE_KEY): Promise<SourceFile[]> {
  if (!key) throw new Error('Appen saknar en Google API-nyckel.')
  const root = driveFolderId(folderUrl)
  if (!root) throw new Error('Det ser inte ut som en länk till en Drive-mapp.')
  const files: SourceFile[] = []
  const walk = async (id: string, path: string[], depth: number) => {
    for (const it of await listChildren(id, key)) {
      if (it.mimeType === 'application/vnd.google-apps.folder') {
        if (depth < 3) await walk(it.id, [...path, it.name], depth + 1)
      } else if (/\.(mp3|m4a|wav|pdf)$/i.test(it.name)) {
        files.push({
          id: `drive:${it.id}`,
          path,
          name: it.name,
          size: Number(it.size ?? 0),
          modified: it.modifiedTime,
          load: async () => {
            const r = await fetch(`${API}/${it.id}?alt=media&key=${key}&supportsAllDrives=true`)
            if (!r.ok) throw new Error(`Kunde inte hämta ${it.name} (${r.status})`)
            return r.blob()
          },
        })
      }
    }
  }
  await walk(root, [], 0)
  return files
}
