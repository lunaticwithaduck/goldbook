import { Slot } from '@radix-ui/react-slot';
import { type ButtonHTMLAttributes, type CSSProperties, forwardRef } from 'react';

type Variant = 'solid' | 'soft' | 'ghost';
type Size = 'sm' | 'md';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
};

const sizeStyles: Record<Size, CSSProperties> = {
  sm: {
    fontSize: 'var(--font-2)',
    padding: '0 var(--space-3)',
    height: 28,
  },
  md: {
    fontSize: 'var(--font-3)',
    padding: '0 var(--space-4)',
    height: 34,
  },
};

const variantStyles: Record<Variant, CSSProperties> = {
  solid: {
    background: 'var(--color-text)',
    color: 'var(--color-bg)',
    border: '1px solid var(--color-text)',
  },
  soft: {
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-text)',
    border: '1px solid transparent',
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'soft', size = 'md', asChild, style, ...rest },
  ref,
) {
  const Comp = (asChild ? Slot : 'button') as 'button';
  const css: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    borderRadius: 'var(--radius-2)',
    fontWeight: 'var(--weight-medium)',
    cursor: 'pointer',
    transition: 'opacity 120ms ease',
    ...sizeStyles[size],
    ...variantStyles[variant],
    ...style,
  };
  return <Comp ref={ref} style={css} {...rest} />;
});
