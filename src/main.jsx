import React from 'react'
import ReactDOM from 'react-dom/client'
import GasLedgerApp from './GasLedgerFirebase.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GasLedgerApp />
  </React.StrictMode>
)

// Register service worker for PWA install prompt
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}