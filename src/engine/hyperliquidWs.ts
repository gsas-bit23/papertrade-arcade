import { useEffect, useState, useRef } from 'react';
import { computeBboMid } from './papertradeMath';
export interface PricePoint { time: number; price: number; high?: number; low?: number }
export type Interval = '1m' | '5m' | '15m';
export interface BboTick { coin: 'BTC' | 'ETH'; bid: number; ask: number; bidSz: number; askSz: number; mid: number; changePct: number; spreadBps: number; inDeadband: boolean; timestamp: number; history: PricePoint[] }
const intervalMs = (value: Interval) => value === '1m' ? 60_000 : value === '5m' ? 300_000 : 900_000;
const initial = (coin: 'BTC' | 'ETH'): BboTick => ({ coin, bid: 0, ask: 0, bidSz: 0, askSz: 0, mid: 0, changePct: 0, spreadBps: 0, inDeadband: true, timestamp: 0, history: [] });
export function appendTick(points: PricePoint[], tick: { time: number; price: number }, interval: Interval): PricePoint[] {
  const time = Math.floor(tick.time / intervalMs(interval)) * intervalMs(interval);
  const history = points.slice();
  const last = history.at(-1);
  if (last && time < last.time) return history;
  if (last && time === last.time) history[history.length - 1] = { time, price: tick.price, high: Math.max(last.high ?? last.price, tick.price), low: Math.min(last.low ?? last.price, tick.price) };
  else history.push({ time, price: tick.price, high: tick.price, low: tick.price });
  return history.slice(-80);
}
async function candles(coin: 'BTC' | 'ETH', interval: Interval, signal: AbortSignal): Promise<PricePoint[]> {
  const now = Date.now();
  const response = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval, startTime: now - intervalMs(interval) * 80, endTime: now } }) });
  if (!response.ok) throw new Error('Historical prices unavailable.');
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('Invalid candle response.');
  const byTime = new Map<number, PricePoint>();
  for (const c of data) {
    const point = { time: Number(c.t), price: Number(c.c), high: Number(c.h), low: Number(c.l) };
    if (!Object.values(point).every(Number.isFinite) || point.time <= 0 || point.price <= 0 || point.high < point.low || point.low <= 0 || point.time > now) continue;
    byTime.set(point.time, point);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-80);
}
export function useHyperliquidBbo() {
  const [interval, setIntervalState] = useState<Interval>('1m');
  const intervalRef = useRef(interval);
  const [state, setState] = useState({ BTC: initial('BTC'), ETH: initial('ETH'), wsConnected: false, lastTickMs: 0 });
  const [historyError, setHistoryError] = useState<string | null>(null);
  useEffect(() => {
    intervalRef.current = interval;
    const abort = new AbortController();
    let cancelled = false;
    setHistoryError(null);
    setState(prev => ({ ...prev, BTC: { ...prev.BTC, history: [] }, ETH: { ...prev.ETH, history: [] } }));
    Promise.all([candles('BTC', interval, abort.signal), candles('ETH', interval, abort.signal)]).then(([btc, eth]) => {
      if (cancelled) return;
      setState(prev => {
        const merge = (coin: 'BTC' | 'ETH', points: PricePoint[]) => {
          const current = prev[coin];
          for (const point of current.history) points = appendTick(points, point, interval);
          if (current.timestamp && current.mid > 0) points = appendTick(points, { time: current.timestamp, price: current.mid }, interval);
          return { ...current, history: points, changePct: current.mid > 0 && points[0]?.price ? (current.mid / points[0].price - 1) * 100 : 0 };
        };
        return { ...prev, BTC: merge('BTC', btc), ETH: merge('ETH', eth) };
      });
    }).catch(() => { if (!cancelled) setHistoryError('Historical candles unavailable; showing live samples only.'); });
    return () => { cancelled = true; abort.abort(); };
  }, [interval]);
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setInterval>;
    let lastMessage = 0;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket('wss://api.hyperliquid.xyz/ws');
      const ws = socket;
      ws.onopen = () => {
        if (stopped) return;
        lastMessage = Date.now();
        setState(prev => ({ ...prev, wsConnected: true }));
        for (const coin of ['BTC', 'ETH']) ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'bbo', coin } }));
        heartbeat = setInterval(() => {
          if (Date.now() - lastMessage > 30_000) { ws.close(); return; }
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: 'ping' }));
        }, 10_000);
      };
      ws.onmessage = event => {
        if (stopped) return;
        lastMessage = Date.now();
        try {
          const data = JSON.parse(event.data);
          const coin: unknown = data.data?.coin;
          if (data.channel !== 'bbo' || (coin !== 'BTC' && coin !== 'ETH')) return;
          const bid = Number(data.data.bbo?.[0]?.px), ask = Number(data.data.bbo?.[1]?.px), time = Number(data.data.time);
          const bidSz = Number(data.data.bbo?.[0]?.sz), askSz = Number(data.data.bbo?.[1]?.sz);
          if (![bid, ask, time, bidSz, askSz].every(Number.isFinite) || bid <= 0 || ask < bid || bidSz < 0 || askSz < 0 || time <= 0 || time > Date.now() + 1000) return;
          setState(prev => {
            if (time < prev[coin].timestamp) return prev;
            const result = computeBboMid(bid, ask, prev[coin].mid);
            const history = appendTick(prev[coin].history, { time, price: result.mid }, intervalRef.current);
            return { ...prev, lastTickMs: Date.now(), [coin]: { coin, bid, ask, bidSz, askSz, ...result, timestamp: time, history, changePct: history[0]?.price ? (result.mid / history[0].price - 1) * 100 : 0 } };
          });
        } catch { /* Ignore malformed transport frames; freshness still expires. */ }
      };
      ws.onclose = () => {
        clearInterval(heartbeat);
        if (!stopped) { setState(prev => ({ ...prev, wsConnected: false })); reconnect = setTimeout(connect, 2500); }
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { stopped = true; clearTimeout(reconnect); clearInterval(heartbeat); socket?.close(); };
  }, []);
  return { ...state, interval, setInterval: setIntervalState, historyError };
}
