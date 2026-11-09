import { useCallback, useSyncExternalStore } from 'react'

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    useCallback((notify: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', notify)
      return () => media.removeEventListener('change', notify)
    }, [query]),
    useCallback(() => window.matchMedia(query).matches, [query]),
    () => false,
  )
}
