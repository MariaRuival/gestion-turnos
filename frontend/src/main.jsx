import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './index.css';

// El DSN no es un secreto: solo sirve para ENVIAR eventos al proyecto, no para
// leerlos. environment = hostname separa local, QA y PROD en Sentry.
Sentry.init({
  dsn: 'https://82d4b6b06b5aa165f8583c16597f7f0d@o4512320397639680.ingest.us.sentry.io/4512320458719232',
  environment: window.location.hostname,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 1.0,
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
