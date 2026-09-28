import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { reportRenderFailure } from './DiagnosticsProvider';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private fallback = createRef<HTMLElement>();
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { reportRenderFailure(); this.fallback.current?.focus(); }
  render() {
    if (this.state.failed) return <main ref={this.fallback} className="page-content" role="alert" tabIndex={-1}>
      <h1>Não foi possível mostrar esta página.</h1>
      <p>Seus livros continuam neste dispositivo.</p>
      <button className="button button-primary" onClick={() => this.setState({ failed: false })}>Tentar novamente</button>
      <a className="button button-secondary" href="/#/estante">Voltar à estante</a>
    </main>;
    return this.props.children;
  }
}
