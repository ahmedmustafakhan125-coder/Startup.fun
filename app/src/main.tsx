import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { startLiveSync } from './store/live'
import { useStore } from './store/useStore'

// Live mode reads the devnet program on load and keeps polling. Mock mode skips this.
startLiveSync(useStore.getState().refresh)

// The single-file preview build runs inside a sandboxed frame, so it keeps its route in memory.
const Router = import.meta.env.MODE === 'preview' ? MemoryRouter : BrowserRouter

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
)
