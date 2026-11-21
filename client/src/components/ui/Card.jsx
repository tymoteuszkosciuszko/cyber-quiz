import { cn } from './utils';

export function Card({ interactive = false, className, children, ...props }) {
  return (
    <div
      className={cn(
        'rounded-base border-2 border-border bg-secondary-background text-foreground shadow-shadow',
        interactive &&
          'cursor-pointer transition-all hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none active:translate-x-boxShadowX active:translate-y-boxShadowY active:shadow-none',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }) {
  return (
    <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }) {
  return (
    <h2
      className={cn('font-heading text-xl md:text-2xl font-extrabold leading-tight tracking-tight', className)}
      {...props}
    >
      {children}
    </h2>
  );
}

export function CardDescription({ className, children, ...props }) {
  return (
    <p className={cn('text-sm font-base text-foreground/75', className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...props }) {
  return (
    <div className={cn('p-6 pt-0', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }) {
  return (
    <div className={cn('flex items-center p-6 pt-0', className)} {...props}>
      {children}
    </div>
  );
}
