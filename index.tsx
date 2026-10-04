import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Capacitor } from '@capacitor/core';
import { installDiagnostics } from './services/clientDiagnostics';


// 记下最近几次前端报错，学生求助时随问题一起带上。
installDiagnostics();

if (Capacitor.isNativePlatform()) {
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    StatusBar.setOverlaysWebView({ overlay: false });
    StatusBar.setStyle({ style: Style.Light });
  });
}

// A lazy chunk can 404 after a redeploy replaces hashed assets (or on a flaky
// network). Reload once to pick up the fresh index.html instead of showing a
// broken "Failed to fetch dynamically imported module" screen.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'chunk-reload-at';
  const last = Number(sessionStorage.getItem(key) ?? 0);
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem(key, String(Date.now()));
    event.preventDefault();
    window.location.reload();
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
