import type { ReactNode, CSSProperties } from 'react';

type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'accent';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  style?: CSSProperties;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-white/10 text-text-secondary',
  success: 'bg-success/20 text-success',
  danger: 'bg-danger/20 text-danger',
  warning: 'bg-warning/20 text-warning',
  info: 'bg-info/20 text-info',
  accent: 'bg-accent/20 text-accent',
};

export function Badge({ variant = 'default', children, style }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${variantClasses[variant]}`}
      style={style}
    >
      {children}
    </span>
  );
}
