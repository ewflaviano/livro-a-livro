import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

type Props = { title: string; description: string; detail: string; back?: boolean };

export function PlaceholderPage({ title, description, detail, back = false }: Props) {
  const location = useLocation();
  const destination = location.state?.returnTo;
  const returnTo = ['/estante', '/lendo', '/quero-ler'].includes(destination) ? destination : '/estante';
  useEffect(() => { document.title = `${title} · Livro a Livro`; }, [title]);
  return (
    <section className="page-content" aria-labelledby="page-title">
      {back && <Link className="back-link" to={returnTo}><ArrowLeft aria-hidden="true" />Voltar para a estante</Link>}
      <p className="eyebrow">Sua história em livros</p>
      <h1 id="page-title">{title}</h1>
      <p className="page-description">{description}</p>
      <div className="notice-panel">
        <span className="stage-label">Em construção</span>
        <p>{detail}</p>
      </div>
    </section>
  );
}
