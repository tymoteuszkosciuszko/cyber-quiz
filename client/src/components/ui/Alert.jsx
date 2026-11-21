import { cn } from './utils';

const VARIANT_CLASSES = {
  default: 'bg-main text-main-foreground',
  neutral: 'bg-secondary-background text-foreground',
  danger: 'bg-danger text-foreground',
  warning: 'bg-warning text-foreground',
};

export function Alert({ variant = 'default', className, children, ...props }) {
  return (
    <div
      role="alert"
      className={cn(
        'relative w-full rounded-base border-2 border-border p-4 text-sm font-base shadow-shadow',
        VARIANT_CLASSES[variant] || VARIANT_CLASSES.default,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
