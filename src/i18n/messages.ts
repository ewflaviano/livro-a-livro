import type { Locale } from './locale';

const pt = {
  appName: 'Livro a Livro',
  settings: 'Configurações',
  shelf: 'Estante',
  yourData: 'Seus dados',
  install: 'Instalar',
  loading: 'Carregando…',
  retry: 'Tentar novamente',
  cancel: 'Cancelar',
  save: 'Salvar',
  close: 'Fechar',
} as const;

const en: Record<keyof typeof pt, string> = {
  appName: 'Livro a Livro',
  settings: 'Settings',
  shelf: 'Shelf',
  yourData: 'Your data',
  install: 'Install',
  loading: 'Loading…',
  retry: 'Try again',
  cancel: 'Cancel',
  save: 'Save',
  close: 'Close',
};

export type MessageKey = keyof typeof pt;
const catalogs: Record<Locale, Record<MessageKey, string>> = { 'pt-BR': pt, en };

export function message(locale: Locale, key: MessageKey): string {
  return catalogs[locale][key];
}
