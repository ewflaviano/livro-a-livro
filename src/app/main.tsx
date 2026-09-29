import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './router';
import { LocaleProvider } from '../i18n/context';
import '../../docs/tokens.css';
import '../ui/styles/app.css';
import { observePwaInteraction } from '../pwa/register';

observePwaInteraction();

createRoot(document.getElementById('root')!).render(
  <StrictMode><LocaleProvider><AppRouter /></LocaleProvider></StrictMode>,
);
