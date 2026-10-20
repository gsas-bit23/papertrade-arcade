import { useEffect, useState, useRef, useCallback } from 'react';
import { computeBboMid } from './papertradeMath';

export interface PricePoint {
  time: number;
  price: number;
  high?: number;
  low?: number;
}

export interface BboTick {
  coin: 'BTC' | 'ETH';
  bid: number;
  ask: number;
  bidSz: number;
  askSz: number;
  mid: number;
  change24hPct: number;
  spreadBps: number;
  inDeadband: boolean;
  timestamp: number;
  history: PricePoint[];
}

export interface LiveBboState {
  BTC: BboTick;
  ETH: BboTick;
  wsConnected: boolean;
  lastTickMs: number;
  interval: '1m' | '5m' | '15m';
  setInterval: (interval: '1m' | '5m' | '15m') => void;
}

const INITIAL_TICK = (coin: 'BTC' | 'ETH'): BboTick => ({
  coin,
  bid: 0,
  ask: 0,
  bidSz: 0,
  askSz: 0,
  mid: 0,
  change24hPct: 0,
  spreadBps: 0,
  inDeadband: true,
  timestamp: Date.now(),
  history: [],
});

async function fetchHyperliquidCandles(
  coin: 'BTC' | 'ETH',
  interval: '1m' | '5m' | '15m'
): Promise<{ points: PricePoint[]; changePct: number }> {
  const now = Date.now();
  const mult = interval === '1m' ? 60_000 : interval === '5m' ? 300_000 : 900_000;
  const startTime = now - mult * 80;

  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: {
        coin,
        interval,
        startTime,
        endTime: now,
      },
    }),
  });

  if (!res.ok) return { points: [], changePct: 0 };
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) return { points: [], changePct: 0 };

  const points: PricePoint[] = raw.map(
    (c: { t: number; c: string; h: string; l: string }) => ({
      time: c.t,
      price: parseFloat(c.c),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
    })
  );

  const first = points[0]?.price || 1;
  const last = points[points.length - 1]?.price || first;
  const changePct = ((last - first) / first) * 100;

  return { points, changePct };
}

export function useHyperliquidBbo(): LiveBboState {
  const [interval, setIntervalState] = useState<'1m' | '5m' | '15m'>('1m');
  const [state, setState] = useState< Omit<LiveBboState, 'interval' | 'setInterval'> >({
    BTC: INITIAL_TICK('BTC'),
    ETH: INITIAL_TICK('ETH'),
    wsConnected: false,
    lastTickMs: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const loadHistorical = useCallback(async (tf: '1m' | '5m' | '15m') => {
    try {
      const [btcData, ethData] = await Promise.all([
        fetchHyperliquidCandles('BTC', tf),
        fetchHyperliquidCandles('ETH', tf),
      ]);

      setState((prev) => {
        const btcLast =
          btcData.points[btcData.points.length - 1]?.price || prev.BTC.mid;
        const ethLast =
          ethData.points[ethData.points.length - 1]?.price || prev.ETH.mid;

        return {
          ...prev,
          BTC: {
            ...prev.BTC,
            mid: prev.BTC.mid > 0 ? prev.BTC.mid : btcLast,
            bid: prev.BTC.bid > 0 ? prev.BTC.bid : btcLast,
            ask: prev.BTC.ask > 0 ? prev.BTC.ask : btcLast,
            change24hPct: btcData.changePct,
            history:
              btcData.points.length > 0 ? btcData.points : prev.BTC.history,
          },
          ETH: {
            ...prev.ETH,
            mid: prev.ETH.mid > 0 ? prev.ETH.mid : ethLast,
            bid: prev.ETH.bid > 0 ? prev.ETH.bid : ethLast,
            ask: prev.ETH.ask > 0 ? prev.ETH.ask : ethLast,
            change24hPct: ethData.changePct,
            history:
              ethData.points.length > 0 ? ethData.points : prev.ETH.history,
          },
        };
      });
    } catch {
      // Ignore snapshot fetch error
    }
  }, []);

  useEffect(() => {
    loadHistorical(interval);
  }, [interval, loadHistorical]);

  useEffect(() => {
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      try {
        const ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
        wsRef.current = ws;

        ws.onopen = () => {
          if (unmounted) return;
          setState((prev) => ({ ...prev, wsConnected: true }));
          ws.send(
            JSON.stringify({
              method: 'subscribe',
              subscription: { type: 'bbo', coin: 'BTC' },
            })
          );
          ws.send(
            JSON.stringify({
              method: 'subscribe',
              subscription: { type: 'bbo', coin: 'ETH' },
            })
          );
        };

        ws.onmessage = (event) => {
          if (unmounted) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg?.channel === 'bbo' && msg?.data?.bbo?.length >= 2) {
              const coin = msg.data.coin as 'BTC' | 'ETH';
              if (coin !== 'BTC' && coin !== 'ETH') return;

              const bid = parseFloat(msg.data.bbo[0].px);
              const bidSz = parseFloat(msg.data.bbo[0].sz);
              const ask = parseFloat(msg.data.bbo[1].px);
              const askSz = parseFloat(msg.data.bbo[1].sz);
              const time = msg.data.time || Date.now();

              if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;

              setState((prev) => {
                const current = prev[coin];
                const { mid, spreadBps, inDeadband } = computeBboMid(
                  bid,
                  ask,
                  current.mid > 0 ? current.mid : undefined
                );

                // Update the live tip of the chart history smoothly
                const history = [...current.history];
                if (history.length > 0) {
                  const lastPt = history[history.length - 1];
                  if (time - lastPt.time < 15_000) {
                    history[history.length - 1] = {
                      ...lastPt,
                      price: mid,
                      high: Math.max(lastPt.high ?? mid, mid),
                      low: Math.min(lastPt.low ?? mid, mid),
                    };
                  } else {
                    history.push({ time, price: mid, high: mid, low: mid });
                    if (history.length > 90) history.shift();
                  }
                } else {
                  history.push({ time, price: mid, high: mid, low: mid });
                }

                const firstPrice = history[0]?.price || mid;
                const change24hPct =
                  firstPrice > 0 ? ((mid - firstPrice) / firstPrice) * 100 : 0;

                return {
                  ...prev,
                  lastTickMs: Date.now(),
                  [coin]: {
                    coin,
                    bid,
                    ask,
                    bidSz,
                    askSz,
                    mid,
                    change24hPct,
                    spreadBps,
                    inDeadband,
                    timestamp: time,
                    history,
                  },
                };
              });
            }
          } catch {
            // Ignore malformed WS payloads
          }
        };

        ws.onclose = () => {
          if (unmounted) return;
          setState((prev) => ({ ...prev, wsConnected: false }));
          reconnectTimerRef.current = window.setTimeout(connect, 2500);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        reconnectTimerRef.current = window.setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    ...state,
    interval,
    setInterval: setIntervalState,
  };
}
