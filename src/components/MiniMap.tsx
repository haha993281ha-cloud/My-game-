import React, { useMemo } from 'react';
import { RacerHudDot } from '../game/types';

interface MiniMapProps {
  points: { x: number; z: number }[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  dots: RacerHudDot[];
}

export const MiniMap: React.FC<MiniMapProps> = ({ points, bounds, dots }) => {
  const size = 128;
  const pad = 12;

  const { pathD, project } = useMemo(() => {
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
    const scale = (size - pad * 2) / Math.max(spanX, spanZ);
    const offsetX = (size - spanX * scale) * 0.5 - bounds.minX * scale;
    const offsetZ = (size - spanZ * scale) * 0.5 - bounds.minZ * scale;

    const proj = (x: number, z: number) => ({
      sx: x * scale + offsetX,
      sy: z * scale + offsetZ,
    });

    if (points.length === 0) {
      return { pathD: '', project: proj };
    }

    const d =
      points
        .map((pt, idx) => {
          const { sx, sy } = proj(pt.x, pt.z);
          return `${idx === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
        })
        .join(' ') + ' Z';

    return { pathD: d, project: proj };
  }, [points, bounds]);

  return (
    <div className="bg-[#0B0E14]/90 border border-white/12 rounded-xl p-2 shadow-lg">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Circuit minimap">
        <path
          d={pathD}
          fill="none"
          stroke="rgba(148, 163, 184, 0.35)"
          strokeWidth={6}
          strokeLinejoin="round"
        />
        <path
          d={pathD}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {dots.map((dot) => {
          const { sx, sy } = project(dot.x, dot.z);
          return (
            <circle
              key={dot.id}
              cx={sx}
              cy={sy}
              r={dot.isPlayer ? 4.5 : 3}
              fill={dot.isPlayer ? '#EF4444' : dot.color}
              stroke="#0B0E14"
              strokeWidth={1.2}
            />
          );
        })}
      </svg>
    </div>
  );
};
