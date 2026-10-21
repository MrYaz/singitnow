import { createContext, useContext } from 'react'
import type { Settings } from './lib/learn'

export const SettingsContext = createContext<{ settings: Settings; reload: () => Promise<void> }>(null!)
export const useSettings = () => useContext(SettingsContext)
