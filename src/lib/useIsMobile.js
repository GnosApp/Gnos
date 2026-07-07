/**
 * DEV MODE: always returns false so mobile layout is never triggered during
 * desktop testing. When ready to restore real detection, replace the body with:
 *
 *   import { useState } from 'react'
 *   export function useIsMobile() {
 *     const [v] = useState(() => window.matchMedia('(pointer: coarse)').matches)
 *     return v
 *   }
 */
export function useIsMobile() {
  return false
}
