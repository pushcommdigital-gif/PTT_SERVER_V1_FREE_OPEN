/*
 * PushComm Community Edition
 * Copyright (C) 2026 Corbani Mauro
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
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
