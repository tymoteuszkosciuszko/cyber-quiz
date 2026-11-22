import { cn } from './utils';

const VARIANT_CLASSES = {
  default:
    'text-main-foreground bg-main border-2 border-border shadow-shadow hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none active:translate-x-boxShadowX active:translate-y-boxShadowY active:shadow-none',
  neutral:
    'bg-secondary-background text-foreground border-2 border-border shadow-shadow hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none active:translate-x-boxShadowX active:translate-y-boxShadowY active:shadow-none',
  danger:
    'bg-danger text-foreground border-2 border-border shadow-shadow hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none active:translate-x-boxShadowX active:translate-y-boxShadowY active:shadow-none',
  warning:
    'bg-warning text-foreground border-2 border-border shadow-shadow hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none active:translate-x-boxShadowX active:translate-y-boxShadowY active:shadow-none',
  noShadow:
    'text-main-foreground bg-main border-2 border-border',
  reverse:
    'text-main-foreground bg-main border-2 border-border hover:translate-x-reverseBoxShadowX hover:translate-y-reverseBoxShadowY hover:shadow-shadow',
};

const SIZE_CLASSES = {
  sm: 'h-9 px-3 text-xs',
  default: 'h-11 px-5 py-2 text-sm',
  lg: 'min-h-[3.25rem] px-6 py-3 text-base',
  icon: 'h-10 w-10',
};

export function Button({
  as: Component = 'button',
  variant = 'default',
  size = 'default',
  className,
  children,
  ...props
}) {
  return (
    <Component
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-base font-heading font-bold ring-offset-secondary-background transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant] || VARIANT_CLASSES.default,
        SIZE_CLASSES[size] || SIZE_CLASSES.default,
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
