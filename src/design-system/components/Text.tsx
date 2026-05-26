import type { CSSProperties, ElementType, ReactNode } from 'react';
import type { ColorToken, FontToken } from '../tokens.js';
import { weight } from '../tokens.js';

type TextProps = {
  as?: ElementType;
  children?: ReactNode;
  size?: FontToken;
  color?: ColorToken;
  muted?: boolean;
  weight?: keyof typeof weight;
  mono?: boolean;
  truncate?: boolean;
  align?: 'left' | 'center' | 'right';
  style?: CSSProperties;
  className?: string;
};

export function Text({
  as: Tag = 'span',
  children,
  size = 3,
  color,
  muted,
  weight: w = 'regular',
  mono,
  truncate,
  align,
  style,
  className,
}: TextProps) {
  const css: CSSProperties = {
    fontSize: `var(--font-${size})`,
    color: color ? `var(--color-${color})` : 'var(--color-text)',
    opacity: muted ? 0.6 : 1,
    fontWeight: weight[w],
    fontFamily: mono ? 'var(--font-family-mono)' : undefined,
    textAlign: align,
    ...(truncate
      ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }
      : null),
    ...style,
  };
  return (
    <Tag style={css} className={className}>
      {children}
    </Tag>
  );
}
