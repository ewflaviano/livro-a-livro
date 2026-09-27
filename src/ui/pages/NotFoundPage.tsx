import { useEffect } from 'react';
import { Link } from 'react-router-dom';
export function NotFoundPage() {
  useEffect(() => { document.title = 'Página não encontrada · Livro a Livro'; }, []);
  return <section><h1>Página não encontrada</h1><p>Este endereço não faz parte do Livro a Livro. Seus registros continuam neste dispositivo.</p><div className="form-actions"><Link className="button button-primary" to="/estante">Voltar para a estante</Link><Link className="button button-secondary" to="/dados">Seus dados e backup</Link></div></section>;
}
