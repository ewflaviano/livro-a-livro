export const authorizationStates = ['identifying', 'authorize-drive', 'authorization-expired', 'authorization-waiting', 'authorization-error'];
export const syncLabels = {
  identifying: 'Conclua a identificação no Google. Os envios continuam desabilitados.',
  'authorize-drive': 'Você entrou com Google. O Drive ainda não foi autorizado.',
  'authorization-expired': 'Não foi possível confirmar esta autorização. Entre com Google novamente. Sua biblioteca continua aqui.',
  'authorization-error': 'Não foi possível verificar a autorização. Sua biblioteca continua aqui e os envios estão desabilitados.',
  'authorization-waiting': 'A autorização ainda não foi confirmada. Conclua no Google ou verifique novamente. Sua biblioteca e seu backup continuam disponíveis offline.',
  disabled: 'Seus dados estão apenas neste dispositivo.', paused: 'Sincronização pausada neste dispositivo.',
  pending: 'Salvo aqui. Alterações aguardando envio ao Drive.', syncing: 'Sincronizando diretamente com seu Google Drive…',
  synced: 'Cópia confirmada no Google Drive.', offline: 'Salvo aqui. Aguardando conexão para sincronizar.',
  reconnect: 'Reconecte o Google Drive para continuar os envios. Seus dados locais continuam aqui.',
  error: 'Não foi possível sincronizar. Seus dados locais continuam aqui.',
  quota: 'Seu Google Drive está sem espaço. Libere espaço ou exporte uma cópia; seus livros continuam salvos aqui.',
  conflict: 'Há versões diferentes da biblioteca. Confira as cópias antes de escolher.',
};
