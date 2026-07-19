'use client';
import React, { Component, ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }
  render() {
    if (this.state.error) {
      return (
        <tr>
          <td colSpan={10} style={{ padding: 20, color: 'red', background: '#ffebee' }}>
            <strong>Panel Error:</strong> {(this.state.error as Error).message}
          </td>
        </tr>
      );
    }
    return this.props.children;
  }
}
