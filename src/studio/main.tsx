import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './studio.css'
import { Studio } from './Studio'

createRoot(document.getElementById('studio-root')!).render(
  <StrictMode>
    <Studio />
  </StrictMode>,
)
