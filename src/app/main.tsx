import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './router';
import '../../docs/tokens.css';
import '../ui/styles/app.css';
import { registerPwa } from '../pwa/register';

if (import.meta.env.PROD) void registerPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode><AppRouter /></StrictMode>,
);
