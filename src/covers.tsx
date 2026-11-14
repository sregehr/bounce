import { createContext, useContext, useState, type ReactNode } from 'react'
import street from './assets/covers/street.jpg'
import studio from './assets/covers/studio.jpg'
import stage from './assets/covers/stage.jpg'
import rooftop from './assets/covers/rooftop.jpg'

export const COVERS = [
  { id: 'street', label: 'As taken', src: street, alt: 'The photo as taken: the artist on a city street at dusk' },
  { id: 'studio', label: 'Studio', src: studio, alt: 'The same artist placed in a recording studio' },
  { id: 'stage', label: 'Stage', src: stage, alt: 'The same artist placed on a concert stage' },
  { id: 'rooftop', label: 'Rooftop', src: rooftop, alt: 'The same artist placed on a rooftop at sunset' },
] as const

export type CoverId = (typeof COVERS)[number]['id']

const CoverContext = createContext<{ cover: CoverId; setCover: (c: CoverId) => void }>({
  cover: 'stage',
  setCover: () => {},
})

/** The chosen cover is shared between the Cover art screen and the Player backdrop. */
export function CoverProvider({ children }: { children: ReactNode }) {
  const [cover, setCover] = useState<CoverId>('stage')
  return <CoverContext.Provider value={{ cover, setCover }}>{children}</CoverContext.Provider>
}

export function useCover() {
  const ctx = useContext(CoverContext)
  return { ...ctx, current: COVERS.find((c) => c.id === ctx.cover)! }
}
