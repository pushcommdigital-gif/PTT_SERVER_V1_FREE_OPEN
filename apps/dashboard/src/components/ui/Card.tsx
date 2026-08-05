import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className = '', padding = true }: CardProps) {
  return (
    <div className={`rounded-lg bg-bg-card border border-border ${padding ? 'p-5' : ''} ${className}`}>
      {children}
    </div>
  );
}
