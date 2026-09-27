type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export type InstallState = { installed: boolean; available: boolean; busy: boolean; outcome: 'none' | 'accepted' | 'dismissed' | 'failed' };
let state: InstallState = { installed: false, available: false, busy: false, outcome: 'none' };
let pending: InstallPrompt | undefined;
let started = false;
const listeners = new Set<() => void>();
const publish = (patch: Partial<InstallState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const getInstallState = () => state;
export const subscribeInstall = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function startInstallObservation() {
  if (started) return;
  started = true;
  const standalone = window.matchMedia?.('(display-mode: standalone)');
  const observe = () => {
    const installed = standalone?.matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installed) pending = undefined;
    publish({ installed, available: !installed && !!pending });
  };
  observe();
  standalone?.addEventListener('change', observe);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    if (state.installed) return;
    pending = event as InstallPrompt;
    publish({ available: true, outcome: 'none' });
  });
  window.addEventListener('appinstalled', () => { pending = undefined; publish({ installed: true, available: false, busy: false, outcome: 'none' }); });
}
export async function requestInstall() {
  if (!pending || state.busy || state.installed) return;
  const prompt = pending; pending = undefined;
  publish({ available: false, busy: true, outcome: 'none' });
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (!state.installed) publish({ outcome: choice.outcome });
  } catch { if (!state.installed) publish({ outcome: 'failed' }); }
  finally { publish({ busy: false }); }
}
