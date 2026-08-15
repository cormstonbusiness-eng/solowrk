import { createContext, useContext } from 'react'
import type { WorkspaceStatus } from '@shared/types'

export interface WorkspaceContextValue {
  status: WorkspaceStatus | null
  setStatus: (status: WorkspaceStatus) => void
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  status: null,
  setStatus: () => {}
})

/** The current workspace, resolved once at startup by the app root. */
export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext)
}