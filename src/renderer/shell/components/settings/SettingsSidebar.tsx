/**
 * Settings Sidebar Component
 *
 * Always-expanded navigation sidebar for settings sections
 */

import { cn } from '../../../src/lib/utils'
import { useSettingsContext } from './hooks/useSettingsContext'
import { SETTINGS_SECTIONS } from './constants'

export function SettingsSidebar(): React.JSX.Element {
  const { activeSection, setActiveSection } = useSettingsContext()

  return (
    <nav className="w-[220px] shrink-0 border-r py-4 bg-muted/30">
      <div className="flex flex-col gap-1 px-3">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon
          const isActive = activeSection === section.id
          const isDanger = section.id === 'danger-zone'

          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors text-sm',
                isActive && !isDanger && 'bg-background shadow-sm font-medium text-foreground',
                isActive && isDanger && 'bg-destructive/10 text-destructive font-medium',
                !isActive &&
                  !isDanger &&
                  'text-foreground/70 hover:text-foreground hover:bg-background/50',
                isDanger &&
                  !isActive &&
                  'text-destructive/70 hover:text-destructive hover:bg-destructive/5'
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  isDanger ? 'text-destructive' : 'text-foreground/60',
                  isActive && !isDanger && 'text-foreground'
                )}
              />
              <span className="truncate">{section.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
