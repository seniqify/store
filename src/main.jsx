import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startVersionGuard } from './utils/versionGuard'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Reload stale tabs to the latest deployed build (never mid-typing).
startVersionGuard()
