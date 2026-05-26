import type { CSSProperties, ReactNode } from 'react';
import type { SpaceToken } from '../tokens.js';

type Direction = 'row' | 'column';
type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
type Justify = 'start' | 'center' | 'end' | 'between' | 'around';

const alignMap: Record<Align, CSSProperties['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const justifyMap: Record<Justify, CSSProperties['justifyContent']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
};

type StackProps = {
  children: ReactNode;
  direction?: Direction;
  gap?: SpaceToken;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  flex?: number | string;
  style?: CSSProperties;
  className?: string;
};

export function Stack({
  children,
  direction = 'column',
  gap = 2,
  align = 'stretch',
  justify = 'start',
  wrap = false,
  flex,
  style,
  className,
}: StackProps) {
  const css: CSSProperties = {
    display: 'flex',
    flexDirection: direction,
    gap: `var(--space-${gap})`,
    alignItems: alignMap[align],
    justifyContent: justifyMap[justify],
    flexWrap: wrap ? 'wrap' : 'nowrap',
    flex,
    minHeight: 0,
    minWidth: 0,
    ...style,
  };
  return (
    <div style={css} className={className}>
      {children}
    </div>
  );
}
