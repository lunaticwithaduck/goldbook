export function Separator({ vertical = false }: { vertical?: boolean }) {
  return (
    <div
      style={{
        background: 'var(--color-border)',
        ...(vertical ? { width: 1, alignSelf: 'stretch' } : { height: 1, width: '100%' }),
      }}
    />
  );
}
