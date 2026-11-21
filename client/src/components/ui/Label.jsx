import { cn } from './utils';

export function Label({ className, children, ...props }) {
  return (
    <label
      className={cn('block text-sm font-heading font-bold leading-none text-foreground', className)}
      {...props}
    >
      {children}
    </label>
  );
}
