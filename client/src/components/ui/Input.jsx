import { forwardRef } from 'react';
import { cn } from './utils';

export const Input = forwardRef(function Input(
  { className, type = 'text', ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-11 w-full rounded-base border-2 border-border bg-secondary-background px-3.5 py-2 text-sm font-base text-foreground selection:bg-main selection:text-main-foreground placeholder:text-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
});
