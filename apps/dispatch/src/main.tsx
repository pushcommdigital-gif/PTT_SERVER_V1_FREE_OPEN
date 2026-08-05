import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { VoiceProvider } from './contexts/VoiceContext';
import { App } from './App';
// EXTENSION POINT: importing the add-ons index runs its registerPanel() calls
// before the console renders. Empty in Community Edition.
import './addons';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <WebSocketProvider>
          <VoiceProvider>
            <App />
          </VoiceProvider>
        </WebSocketProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
