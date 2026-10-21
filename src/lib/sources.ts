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
export const DRIVE_KEY: string | undefined = (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined)?.trim() || undefined

/** Finds the folder id in a pasted Drive link, ignoring spaces, line breaks and extras like ?usp=sharing. */
export function driveFolderId(url: string): string | null {
  const u = url.replace(/\s+/g, '')
  const m = u.match(/folders\/([\w-]{10,})/) ?? u.match(/[?&]id=([\w-]{10,})/) ?? u.match(/^([\w-]{20,})$/)
  return m ? m[1] : null
}

export const cleanDriveUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`

let linked = false
/** Reads a Drive folder from the app's address (?drive=<link or id>) and removes it from the address bar. */
export function readDriveParam(): string | null {
  const params = new URLSearchParams(location.search)
  const raw = params.get('drive')
  if (raw === null) return null
  params.delete('drive')
  const q = params.toString()
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash)
  const id = driveFolderId(raw)
  if (!id) return null
  linked = true
  return cleanDriveUrl(id)
}

/** True once, if the app was opened with a Drive link, so the import can start by itself. */
export function takeLinkedDrive(): boolean {
  const was = linked
  linked = false
  return was
}

/** A link that opens the app with this Drive folder filled in, to share with the choir. */
export function shareLink(driveUrl: string): string | null {
  const id = driveFolderId(driveUrl)
  return id ? `${location.origin}${import.meta.env.BASE_URL}?drive=${id}` : null
}

/** fetch, with a clear message when the request never reaches Google. */
async function driveFetch(url: string, tries = 3): Promise<Response> {
  try {
    return await fetch(url)
  } catch {
    // Google sometimes refuses a request for a moment (and then without the headers the browser needs).
    if (tries > 1) {
      await new Promise((r) => setTimeout(r, 1500))
      return driveFetch(url, tries - 1)
    }
    throw new Error(
      `Kunde inte nå Google Drive. Kolla att du är uppkopplad. Fungerar det ändå inte kan API-nyckeln sakna ${location.origin} bland tillåtna webbplatser.`,
    )
  }
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
      `${API}?q=${q}&key=${encodeURIComponent(key)}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true` +
      `&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime)` +
      (page ? `&pageToken=${page}` : '')
    const res = await driveFetch(url)
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
            const r = await driveFetch(`${API}/${it.id}?alt=media&key=${encodeURIComponent(key)}&supportsAllDrives=true`)
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
