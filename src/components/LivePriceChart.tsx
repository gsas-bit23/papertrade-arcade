import React, { useState } from 'react';
import { PricePoint } from '../engine/hyperliquidWs';

interface LivePriceChartProps {
  coin: 'BTC' | 'ETH';
  midPrice: number;
  bid: number;
  ask: number;
  changePct: number;
  history: PricePoint[];
  entryPrice: number;
  bustPrice: number;
  isLong: boolean;
  leverage: number;
  interval: '1m' | '5m' | '15m';
  onChangeInterval: (tf: '1m' | '5m' | '15m') => void;
}

export const LivePriceChart: React.FC<LivePriceChartProps> = ({
  coin,
  midPrice,
  bid,
  ask,
  changePct,
  history,
  entryPrice,
  bustPrice,
  isLong,
  leverage,
  interval,
  onChangeInterval,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showBustLine, setShowBustLine] = useState<boolean>(true);

  const width = 760;
  const height = 240;
  const padLeft = 14;
  const padRight = 78;
  const padTop = 22;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const digits = coin === 'BTC' ? 1 : 2;
  const fmt = (n: number) =>
    n.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });

  if (history.length < 2) {
    return (
      <div
        className="card-surface"
        style={{
          height: 290,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
        }}
      >
        Loading live {coin}/USD chart from Hyperliquid...
      </div>
    );
  }

  const prices = history.map((p) => p.price);
  if (showBustLine && bustPrice > 0) {
    prices.push(bustPrice);
  }
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const range = Math.max(rawMax - rawMin, midPrice * 0.0008);
  const minP = rawMin - range * 0.12;
  const maxP = rawMax + range * 0.12;

  const toX = (i: number) =>
    padLeft + (i / Math.max(1, history.length - 1)) * plotW;
  const toY = (price: number) =>
    padTop + (1 - (price - minP) / Math.max(0.0001, maxP - minP)) * plotH;

  const linePoints = history
    .map((pt, i) => `${toX(i).toFixed(1)},${toY(pt.price).toFixed(1)}`)
    .join(' ');

  const areaPoints = `${toX(0).toFixed(1)},${(padTop + plotH).toFixed(
    1
  )} ${linePoints} ${toX(history.length - 1).toFixed(1)},${(
    padTop + plotH
  ).toFixed(1)}`;

  const isPositive = changePct >= 0;
  const strokeColor = isPositive ? '#10b981' : '#f43f5e';

  const currentY = toY(midPrice);
  const entryY = toY(entryPrice);
  const bustY = toY(bustPrice);

  const hoveredPoint =
    hoverIdx !== null && history[hoverIdx] ? history[hoverIdx] : null;

  // Grid levels
  const gridLevels = [0.15, 0.5, 0.85].map((ratio) => {
    const val = maxP - ratio * (maxP - minP);
    return { val, y: toY(val) };
  });

  return (
    <div className="card-surface" style={{ padding: '14px 16px' }}>
      {/* Chart Top Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span
            style={{
              fontFamily: 'var(--font-title)',
              fontSize: 15,
              color: '#f8fafc',
            }}
          >
            {coin}/USD
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 26,
              fontWeight: 700,
              color: isPositive ? '#34d399' : '#fb7185',
            }}
          >
            ${fmt(hoveredPoint ? hoveredPoint.price : midPrice)}
          </span>
          <span
            style={{
              fontSize: 12,
              padding: '2px 7px',
              borderRadius: 4,
              background: isPositive
                ? 'rgba(16, 185, 129, 0.15)'
                : 'rgba(244, 63, 94, 0.15)',
              color: isPositive ? '#34d399' : '#fb7185',
              fontWeight: 600,
            }}
          >
            {isPositive ? '+' : ''}
            {changePct.toFixed(2)}%
          </span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            Bid <strong style={{ color: '#34d399' }}>${fmt(bid)}</strong> • Ask{' '}
            <strong style={{ color: '#fb7185' }}>${fmt(ask)}</strong>
          </span>
        </div>

        {/* Timeframe & Overlay Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label
            style={{
              fontSize: 11,
              color: '#94a3b8',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              marginRight: 8,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showBustLine}
              onChange={(e) => setShowBustLine(e.target.checked)}
            />
            Show {leverage}x Bust Line
          </label>
          {(['1m', '5m', '15m'] as const).map((tf) => (
            <button
              key={tf}
              className={`pill-btn ${interval === tf ? 'active' : ''}`}
              onClick={() => onChangeInterval(tf)}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Interactive Price Chart */}
      <div style={{ position: 'relative', width: '100%' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{
            width: '100%',
            height: 235,
            display: 'block',
            background: '#090f1e',
            borderRadius: 8,
            border: '1px solid #1e293b',
          }}
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX =
              ((e.clientX - rect.left) / rect.width) * width - padLeft;
            const ratio = Math.max(0, Math.min(1, relX / plotW));
            const idx = Math.round(ratio * (history.length - 1));
            setHoverIdx(idx);
          }}
        >
          <defs>
            <linearGradient id="priceAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid Lines */}
          {gridLevels.map((g, i) => (
            <g key={i}>
              <line
                x1={padLeft}
                y1={g.y}
                x2={width - padRight}
                y2={g.y}
                stroke="#1e293b"
                strokeDasharray="3 3"
              />
              <text
                x={width - padRight + 6}
                y={g.y + 4}
                fill="#64748b"
                fontSize="10"
                fontFamily="monospace"
              >
                ${fmt(g.val)}
              </text>
            </g>
          ))}

          {/* Shaded Area & Main Price Line */}
          <polygon points={areaPoints} fill="url(#priceAreaGrad)" />
          <polyline
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.5"
            points={linePoints}
          />

          {/* Preview Entry Price Line */}
          {entryY >= padTop && entryY <= height - padBottom && (
            <g>
              <line
                x1={padLeft}
                y1={entryY}
                x2={width - padRight}
                y2={entryY}
                stroke="#38bdf8"
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <rect
                x={padLeft + 6}
                y={entryY - 10}
                width={132}
                height={16}
                rx={3}
                fill="rgba(8, 47, 73, 0.9)"
              />
              <text
                x={padLeft + 11}
                y={entryY + 1}
                fill="#7dd3fc"
                fontSize="9.5"
                fontFamily="monospace"
              >
                {isLong ? 'LONG' : 'SHORT'} ENTRY ${fmt(entryPrice)}
              </text>
            </g>
          )}

          {/* Bust / Liquidation Laser Line */}
          {showBustLine &&
            bustY >= padTop - 6 &&
            bustY <= height - padBottom + 6 && (
              <g>
                <line
                  x1={padLeft}
                  y1={bustY}
                  x2={width - padRight}
                  y2={bustY}
                  stroke="#f43f5e"
                  strokeWidth="1.5"
                  strokeDasharray="6 3"
                />
                <rect
                  x={padLeft + 150}
                  y={bustY - 10}
                  width={158}
                  height={16}
                  rx={3}
                  fill="rgba(127, 29, 29, 0.92)"
                />
                <text
                  x={padLeft + 156}
                  y={bustY + 1}
                  fill="#fecdd3"
                  fontSize="9.5"
                  fontFamily="monospace"
                >
                  ⚡ {leverage}x BUST LASER ${fmt(bustPrice)}
                </text>
              </g>
            )}

          {/* Live Current Price Dot & Tag */}
          <circle
            cx={toX(history.length - 1)}
            cy={currentY}
            r="4.5"
            fill={strokeColor}
          />
          <rect
            x={width - padRight + 2}
            y={currentY - 9}
            width={padRight - 4}
            height={18}
            rx={3}
            fill={strokeColor}
          />
          <text
            x={width - padRight + 6}
            y={currentY + 3}
            fill="#020617"
            fontSize="10"
            fontWeight="bold"
            fontFamily="monospace"
          >
            ${fmt(midPrice)}
          </text>

          {/* Hover Crosshair */}
          {hoveredPoint && hoverIdx !== null && (
            <g>
              <line
                x1={toX(hoverIdx)}
                y1={padTop}
                x2={toX(hoverIdx)}
                y2={height - padBottom}
                stroke="#94a3b8"
                strokeDasharray="2 2"
              />
              <circle
                cx={toX(hoverIdx)}
                cy={toY(hoveredPoint.price)}
                r="4"
                fill="#f8fafc"
              />
              <text
                x={Math.min(width - 140, Math.max(12, toX(hoverIdx) - 40))}
                y={padTop - 5}
                fill="#cbd5e1"
                fontSize="10"
                fontFamily="monospace"
              >
                {new Date(hoveredPoint.time).toLocaleTimeString()} • $
                {fmt(hoveredPoint.price)}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};
