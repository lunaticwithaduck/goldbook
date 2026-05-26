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
  {
    as: Tag = 'div',
    children,
    p,
    px,
    py,
    pt,
    pr,
    pb,
    pl,
    m,
    bg,
    border,
    radius,
    flex,
    style,
    ...rest
  },
  ref,
) {
  // Build the style object conditionally. We MUST NOT emit `paddingLeft: undefined`
  // alongside `padding: '32px'` — React passes both to the DOM and the empty
  // longhand wins, cancelling the shorthand and giving you padding: 0.
  const computed: CSSProperties = {};
  if (p !== undefined) computed.padding = spaceVar(p);
  const padX = spaceVar(px ?? pl);
  const padXR = spaceVar(px ?? pr);
  const padY = spaceVar(py ?? pt);
  const padYB = spaceVar(py ?? pb);
  if (padX !== undefined) computed.paddingLeft = padX;
  if (padXR !== undefined) computed.paddingRight = padXR;
  if (padY !== undefined) computed.paddingTop = padY;
  if (padYB !== undefined) computed.paddingBottom = padYB;
  if (m !== undefined) computed.margin = spaceVar(m);
  if (bg) computed.background = colorVar(bg);
  if (border) computed.border = `1px solid ${colorVar(border)}`;
  if (radius !== undefined) computed.borderRadius = radiusVar(radius);
  if (flex !== undefined) computed.flex = flex;
  if (style) Object.assign(computed, style);

  return (
    <Tag ref={ref} style={computed} {...rest}>
      {children}
    </Tag>
  );
});
