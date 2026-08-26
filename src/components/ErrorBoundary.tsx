/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
import React from 'react';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('UI crashed:', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#f1f3f4', background: '#141619', minHeight: '100vh' }}>
          <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#f87171' }}>{this.state.error.message}</pre>
          <button type="button" onClick={this.reset} style={{ marginTop: 12, padding: '8px 16px' }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
