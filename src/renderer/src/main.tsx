import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Bundled locally so the app has no network dependency for its typography.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'

import './styles/theme.css'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)