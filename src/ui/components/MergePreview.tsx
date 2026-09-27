import type { ResolutionPreview } from '../../sync/merge';
import { ConfirmDialog } from './ConfirmDialog';

export function MergePreview({ preview, busy, error, accountChanged, onCancel, onConfirm }: {
  preview: ResolutionPreview; busy: boolean; error: string; accountChanged?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  return <ConfirmDialog title="Juntar bibliotecas?" confirmLabel="Juntar bibliotecas" variant="primary" busy={busy} onCancel={onCancel} onConfirm={() => onConfirm()}>
    <p>A biblioteca ficará com <strong>{preview.totalCount} {preview.totalCount === 1 ? 'livro' : 'livros'}</strong>: {preview.addedCount} {preview.addedCount === 1 ? 'adicionado' : 'adicionados'} do Drive.</p>
    <p>{preview.divergentCount} {preview.divergentCount === 1 ? 'livro tem versões diferentes' : 'livros têm versões diferentes'}. Quando o mesmo livro estiver neste dispositivo e no Drive, a versão inteira deste dispositivo prevalece, incluindo nota e capa.</p>
    <p>Suas preferências deste dispositivo serão mantidas. Livros presentes em apenas uma biblioteca entram na união; livros excluídos podem voltar.</p>
    {preview.remoteOnlyDivergentCount > 0 && <p className="notice-panel">Há versões diferentes de livros que estão só no Drive. Para esses livros, prevalece a primeira versão do Drive apresentada que contém o livro.</p>}
    {accountChanged && <p className="notice-panel">A conta ou autorização mudou. Ao confirmar, você escolhe enviar a biblioteca unida para esta conexão.</p>}
    <p>Uma cópia de recuperação da biblioteca atual ficará neste dispositivo. O envio ao Drive pode ficar pendente.</p>
    {error && <p role="alert">{error}</p>}
  </ConfirmDialog>;
}
