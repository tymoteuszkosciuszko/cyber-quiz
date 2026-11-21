import { cn } from './utils';

const VARIANT_CLASSES = {
  default: 'bg-main text-main-foreground',
  neutral: 'bg-secondary-background text-foreground',
  danger: 'bg-danger text-foreground',
  warning: 'bg-warning text-foreground',
  info: 'bg-info text-foreground',
  purple: 'bg-purple text-foreground',
};

export function Badge({ variant = 'default', className, children, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-base border-2 border-border px-2.5 py-0.5 text-xs font-heading font-bold whitespace-nowrap',
        VARIANT_CLASSES[variant] || VARIANT_CLASSES.default,
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
