import { type CSSProperties, type ElementType, type ReactNode, forwardRef } from 'react';
import type { ColorToken, RadiusToken, SpaceToken } from '../tokens.js';

type BoxProps = {
  as?: ElementType;
  children?: ReactNode;
  p?: SpaceToken;
  px?: SpaceToken;
  py?: SpaceToken;
  pt?: SpaceToken;
  pr?: SpaceToken;
  pb?: SpaceToken;
  pl?: SpaceToken;
  m?: SpaceToken;
  bg?: ColorToken;
  border?: ColorToken;
  radius?: RadiusToken;
  flex?: number | string;
  style?: CSSProperties;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
};

const spaceVar = (t?: SpaceToken) => (t ? `var(--space-${t})` : undefined);
const colorVar = (t?: ColorToken) => (t ? `var(--color-${t})` : undefined);
const radiusVar = (t?: RadiusToken) => (t ? `var(--radius-${t})` : undefined);

export const Box = forwardRef<HTMLElement, BoxProps>(function Box(
  { as: Tag = 'div', children, p, px, py, pt, pr, pb, pl, m, bg, border, radius, flex, style, ...rest },
  ref,
) {
  const computed: CSSProperties = {
    padding: spaceVar(p),
    paddingLeft: spaceVar(px ?? pl),
    paddingRight: spaceVar(px ?? pr),
    paddingTop: spaceVar(py ?? pt),
    paddingBottom: spaceVar(py ?? pb),
    margin: spaceVar(m),
    background: colorVar(bg),
    border: border ? `1px solid ${colorVar(border)}` : undefined,
    borderRadius: radiusVar(radius),
    flex,
    ...style,
  };
  return (
    <Tag ref={ref} style={computed} {...rest}>
      {children}
    </Tag>
  );
});
