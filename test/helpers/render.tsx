/**
 * React Testing Library Custom Render
 *
 * Provides a custom render function that wraps components with necessary providers.
 */
import { render, RenderOptions } from '@testing-library/react'
import { ReactElement, ReactNode } from 'react'

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  // Add any custom options here if needed
}

/**
 * All providers wrapper for testing.
 * Add any context providers your app uses here.
 */
function AllProviders({ children }: { children: ReactNode }): ReactElement {
  return <>{children}</>
}

/**
 * Custom render function that wraps the component with all necessary providers.
 */
function customRender(ui: ReactElement, options?: CustomRenderOptions) {
  return render(ui, { wrapper: AllProviders, ...options })
}

// Re-export everything from testing-library
export * from '@testing-library/react'

// Override render with custom render
export { customRender as render }
