import { createContext, useContext } from 'react'
import type { Exercise } from './lib/exercises'

export interface LessonItem {
  songId: string
  voice: string
  ex: Exercise
}

export type Screen =
  | { name: 'home' }
  | { name: 'setup' }
  | { name: 'settings' }
  | { name: 'song'; songId: string }
  | { name: 'lesson'; title: string; items: LessonItem[]; level?: { songId: string; voice: string; section: number; level: number } }
  | { name: 'concert'; songId: string }
  | { name: 'rehearsal'; songId: string }
  | { name: 'tune'; songId: string }

export interface Nav {
  go: (s: Screen) => void
  back: () => void
}

export const NavContext = createContext<Nav>({ go: () => {}, back: () => {} })
export const useNav = () => useContext(NavContext)
