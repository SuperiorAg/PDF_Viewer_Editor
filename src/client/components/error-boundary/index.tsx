import { Component, type ErrorInfo, type ReactNode } from 'react';

import { useT } from '../../i18n/use-t';

import styles from './error-boundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// The fallback UI is a function component so it can use the useT hook (a class
// component cannot). The class boundary owns lifecycle; this renders the copy.
function ErrorFallback({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useT();
  return (
    <div className={styles.boundary} role="alert">
      <h1 className={styles.heading}>{t('common:somethingWentWrong')}</h1>
      <p className={styles.message}>{message}</p>
      <button type="button" className={styles.button} onClick={onRetry}>
        {t('common:retry')}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // `state` is declared on React.Component; noImplicitOverride requires `override`.
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Phase 2 will pipe this through the `log:emit` IPC channel.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info);
  }

  retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      return <ErrorFallback message={this.state.error.message} onRetry={this.retry} />;
    }
    return this.props.children;
  }
}
