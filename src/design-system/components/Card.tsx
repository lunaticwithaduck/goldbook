import type { ReactNode } from 'react';
import { Box } from './Box.js';

export function Card({
  children,
  flex,
  padded = true,
}: {
  children: ReactNode;
  flex?: number | string;
  padded?: boolean;
}) {
  return (
    <Box
      bg="surface"
      border="border"
      radius={3}
      p={padded ? 4 : undefined}
      flex={flex}
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}
    >
      {children}
    </Box>
  );
}
