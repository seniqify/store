import { Component } from 'react';
import { Link }      from 'react-router-dom';

/**
 * ErrorBoundary — catches render errors and shows a friendly fallback.
 * Wrap any subtree that might throw (store pages, forms, etc.)
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }

  componentDidCatch(error, info) {
    // In production, pipe this to Sentry / Datadog:
    // Sentry.captureException(error, { extra: info });
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8
                        w-full max-w-sm text-center space-y-4">
          <p className="text-4xl">😕</p>
          <h1 className="text-lg font-extrabold text-gray-900">Something went wrong</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            An unexpected error occurred. Please refresh the page or go back to the home screen.
          </p>
          {process.env.NODE_ENV !== 'production' && (
            <p className="text-xs text-red-400 font-mono bg-red-50 rounded-lg px-3 py-2
                          text-left break-words">
              {this.state.message}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 py-2.5 rounded-xl bg-gray-900 text-white text-sm
                         font-semibold hover:bg-gray-700 transition-colors">
              Refresh
            </button>
            <Link to="/"
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm
                             font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
              Home
            </Link>
          </div>
        </div>
      </div>
    );
  }
}
