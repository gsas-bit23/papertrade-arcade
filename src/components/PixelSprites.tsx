import React from 'react';

export const PixelTraderSprite: React.FC<{
  seed: string;
  isLong: boolean;
  isOpen?: boolean;
  fromQueued?: boolean;
  size?: number;
}> = ({ seed, isLong, isOpen = true, fromQueued = false, size = 32 }) => {
  // Deterministic color palette from address/id seed
  const hash = seed.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const hairColors = ['#ffcc00', '#ff5555', '#55ffff', '#ff66cc', '#ffffff', '#aa55ff'];
  const skinColors = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642'];
  const hair = hairColors[hash % hairColors.length];
  const skin = skinColors[(hash >> 2) % skinColors.length];
  const suit = !isOpen
    ? '#777788'
    : isLong
    ? '#00e676'
    : '#ff1744';
  const hatAccent = fromQueued ? '#ffd700' : isLong ? '#69f0ae' : '#ff8a80';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ imageRendering: 'pixelated', flexShrink: 0 }}
    >
      {/* Hardhat / Visor */}
      <rect x="4" y="1" width="8" height="2" fill={suit} />
      <rect x="3" y="2" width="10" height="1" fill={hatAccent} />
      {/* Hair & Head */}
      <rect x="4" y="3" width="2" height="2" fill={hair} />
      <rect x="5" y="3" width="6" height="4" fill={skin} />
      {/* Pixel Sunglasses / Eyes */}
      {isOpen ? (
        <>
          <rect x="6" y="4" width="2" height="1" fill="#111122" />
          <rect x="9" y="4" width="2" height="1" fill="#111122" />
        </>
      ) : (
        <>
          {/* Dizzy X eyes when busted */}
          <rect x="6" y="4" width="1" height="1" fill="#ff1744" />
          <rect x="9" y="4" width="1" height="1" fill="#ff1744" />
        </>
      )}
      {/* Torso / Jacket */}
      <rect x="4" y="7" width="8" height="5" fill={suit} />
      {/* Tie / Shirt */}
      <rect x="7" y="7" width="2" height="4" fill="#ffffff" />
      <rect x="7" y="8" width="2" height="3" fill={hatAccent} />
      {/* Arms */}
      <rect x="2" y="7" width="2" height="4" fill={suit} />
      <rect x="12" y="7" width="2" height="4" fill={suit} />
      <rect x="2" y="11" width="2" height="1" fill={skin} />
      <rect x="12" y="11" width="2" height="1" fill={skin} />
      {/* Legs */}
      <rect x="5" y="12" width="2" height="3" fill="#1e293b" />
      <rect x="9" y="12" width="2" height="3" fill="#1e293b" />
      {/* Shoes */}
      <rect x="4" y="15" width="3" height="1" fill="#0f172a" />
      <rect x="9" y="15" width="3" height="1" fill="#0f172a" />
    </svg>
  );
};

export const PixelBrinksTruck: React.FC = () => (
  <svg
    width="92"
    height="48"
    viewBox="0 0 46 24"
    style={{ imageRendering: 'pixelated', flexShrink: 0 }}
  >
    {/* Armored Body */}
    <rect x="2" y="4" width="30" height="15" fill="#334155" />
    <rect x="3" y="5" width="28" height="13" fill="#475569" />
    {/* Gold Stripe & HYPERCORE Label */}
    <rect x="3" y="11" width="38" height="2" fill="#facc15" />
    {/* Vault Door on Truck */}
    <rect x="8" y="6" width="8" height="9" fill="#64748b" />
    <rect x="11" y="9" width="2" height="3" fill="#facc15" />
    {/* Cab */}
    <rect x="32" y="7" width="11" height="12" fill="#334155" />
    <rect x="34" y="8" width="7" height="5" fill="#38bdf8" />
    {/* Siren on top */}
    <rect x="34" y="5" width="3" height="2" fill="#ef4444" />
    <rect x="37" y="5" width="3" height="2" fill="#3b82f6" />
    {/* Headlight */}
    <rect x="42" y="14" width="2" height="3" fill="#fef08a" />
    {/* Wheels */}
    <rect x="7" y="17" width="6" height="6" fill="#0f172a" />
    <rect x="9" y="19" width="2" height="2" fill="#94a3b8" />
    <rect x="33" y="17" width="6" height="6" fill="#0f172a" />
    <rect x="35" y="19" width="2" height="2" fill="#94a3b8" />
  </svg>
);

export const PixelPrintingPress: React.FC<{ active?: boolean }> = ({ active = true }) => (
  <svg
    width="88"
    height="56"
    viewBox="0 0 44 28"
    style={{ imageRendering: 'pixelated', flexShrink: 0 }}
  >
    {/* Heavy Iron Frame */}
    <rect x="4" y="4" width="26" height="20" fill="#1e293b" />
    <rect x="6" y="6" width="22" height="16" fill="#334155" />
    {/* Spinning Rollers */}
    <rect x="9" y="8" width="16" height="5" fill="#94a3b8" />
    <rect x="9" y="15" width="16" height="5" fill="#64748b" />
    {/* Fresh Green $PAPER Sheets coming out */}
    <rect x="11" y="13" width="28" height="2" fill="#4ade80" />
    {active && (
      <>
        <rect x="32" y="10" width="8" height="4" fill="#22c55e" />
        <rect x="34" y="11" width="4" height="2" fill="#bbf7d0" />
        <rect x="35" y="16" width="7" height="4" fill="#22c55e" />
      </>
    )}
    {/* Indicator Light */}
    <rect x="7" y="2" width="4" height="2" fill={active ? '#22c55e' : '#ef4444'} />
    {/* Smokestack */}
    <rect x="22" y="0" width="5" height="4" fill="#475569" />
  </svg>
);
