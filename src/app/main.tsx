import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './router';
import '../../docs/tokens.css';
import '../ui/styles/app.css';
import { startInstallObservation } from '../pwa/install';
import { registerPwa } from '../pwa/register';

startInstallObservation();
if (import.meta.env.PROD) void registerPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode><AppRouter /></StrictMode>,
);
