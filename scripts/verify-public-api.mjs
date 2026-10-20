// Read-only probe: GET wallet SSE and OPTIONS submission preflight. Never POST.
// Requires curl; optional first argument is the actual frontend origin.
import { spawnSync } from 'node:child_process';
const origin = new URL(process.argv[2] || 'http://localhost:5173');
if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Supply an HTTP(S) origin only.');
const base = 'https://exchange.papertrade.xyz';
function request(args) {
  const result = spawnSync('curl', ['-sS', '--max-time', '12', '-i', ...args], { encoding: 'utf8', maxBuffer: 2_000_000 });
  if (result.error || ![0, 28].includes(result.status)) throw result.error || new Error(result.stderr);
  return result.stdout;
}
const stream = request(['-H', `Origin: ${origin.origin}`, `${base}/state/user/live?wallet=0x0000000000000000000000000000000000000001`]);
const frame = stream.match(/event: wallet\r?\ndata: ([^\r\n]+)/);
if (!frame) throw new Error('No wallet snapshot returned.');
const wallet = JSON.parse(frame[1]);
if (wallet.address !== '0x0000000000000000000000000000000000000001' || !Number.isSafeInteger(wallet.accountRevision) || !Array.isArray(wallet.operations)) throw new Error('Unexpected wallet snapshot schema.');
const preflight = request(['-X', 'OPTIONS', '-H', `Origin: ${origin.origin}`, '-H', 'Access-Control-Request-Method: POST', '-H', 'Access-Control-Request-Headers: content-type', `${base}/intents`]);
function headers(text) {
  return text.split(/\r?\n/).filter(line => /^(HTTP\/|access-control-|content-type:)/i.test(line));
}
console.log(JSON.stringify({ origin: origin.origin, walletStream: { headers: headers(stream), validSnapshot: true }, submissionPreflight: { headers: headers(preflight) }, transactionsSent: 0, note: 'Read access does not verify submission or settlement. Check all CORS headers for the deployed origin.' }, null, 2));
