import type { SoloApi } from './index'

declare global {
  interface Window {
    solo: SoloApi
  }
}

export {}