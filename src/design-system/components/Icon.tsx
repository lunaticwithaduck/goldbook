import { useState } from 'react';
import { qualityColor } from '../../lib/wow.js';
import { iconUrl } from '../../lib/wow.js';

type Props = {
  icon: string | null | undefined;
  quality?: number | null;
  size?: number;
  alt?: string;
};

/**
 * WoW item icon. Renders a quality-colored border and falls back to a neutral square
 * if the icon name is missing or the image fails to load (e.g. zamimg hiccup).
 */
export function Icon({ icon, quality, size = 40, alt }: Props) {
  const [errored, setErrored] = useState(false);
  const url = iconUrl(icon);
  const border = qualityColor(quality);
  const placeholder = !url || errored;

  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 'var(--radius-2)',
        border: `1px solid ${border}`,
        background: 'var(--color-bg)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {!placeholder ? (
        <img
          src={url ?? undefined}
          alt={alt ?? ''}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setErrored(true)}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-border)',
            fontSize: 'var(--font-1)',
          }}
        >
          ?
        </div>
      )}
    </div>
  );
}
