import '../src/assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ShellThemeProvider } from './context/ShellThemeProvider'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShellThemeProvider>
      <App />
    </ShellThemeProvider>
  </StrictMode>
)
