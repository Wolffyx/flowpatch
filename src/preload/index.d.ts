import { ElectronAPI } from '@electron-toolkit/preload'
import { ProjectAPI } from './project'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    projectAPI: ProjectAPI
  }
}
