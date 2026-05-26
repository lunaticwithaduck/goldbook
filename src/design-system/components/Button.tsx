import { Slot } from '@radix-ui/react-slot';
import { type ButtonHTMLAttributes, type CSSProperties, forwardRef, useState } from 'react';

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

const variantStyles: Record<Variant, { base: CSSProperties; hover: CSSProperties }> = {
  solid: {
    base: {
      background: 'var(--color-text)',
      color: 'var(--color-bg)',
      border: '1px solid var(--color-text)',
    },
    hover: { background: '#fff', borderColor: '#fff' },
  },
  soft: {
    base: {
      background: 'var(--color-surface)',
      color: 'var(--color-text)',
      border: '1px solid var(--color-border)',
    },
    hover: {
      background: 'color-mix(in srgb, var(--color-surface) 70%, var(--color-text) 6%)',
      borderColor: 'color-mix(in srgb, var(--color-border) 60%, var(--color-text) 12%)',
    },
  },
  ghost: {
    base: {
      background: 'transparent',
      color: 'var(--color-text)',
      border: '1px solid transparent',
    },
    hover: { background: 'rgba(255,255,255,0.04)' },
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'soft', size = 'md', asChild, style, onMouseEnter, onMouseLeave, ...rest },
  ref,
) {
  const [hovered, setHovered] = useState(false);
  const Comp = (asChild ? Slot : 'button') as 'button';
  const v = variantStyles[variant];
  const css: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    borderRadius: 'var(--radius-2)',
    fontWeight: 'var(--weight-medium)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    ...sizeStyles[size],
    ...v.base,
    ...(hovered ? v.hover : null),
    ...style,
  };
  return (
    <Comp
      ref={ref}
      style={css}
      onMouseEnter={(e) => {
        setHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHovered(false);
        onMouseLeave?.(e);
      }}
      {...rest}
    />
  );
});
