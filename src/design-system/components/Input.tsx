import { type CSSProperties, type InputHTMLAttributes, forwardRef } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { style, ...rest },
  ref,
) {
  const css: CSSProperties = {
    height: 32,
    padding: '0 var(--space-3)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-2)',
    fontSize: 'var(--font-3)',
    outline: 'none',
    width: '100%',
    ...style,
  };
  return <input ref={ref} style={css} {...rest} />;
});
