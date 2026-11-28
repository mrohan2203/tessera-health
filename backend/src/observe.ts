/* Phase 5: logs and metrics without health data. Logs are one JSON line per event to stdout (shipped to
   CloudWatch in production); labels are route templates and status codes, never ids or values. */
type Labels = Record<string, string>;
const counters = new Map<string, number>();
const sums = new Map<string, { n: number; sum: number; max: number }>();
const key = (name: string, l: Labels) => name + '{' + Object.entries(l).sort().map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`).join(',') + '}';
export const metrics = {
  inc(name: string, l: Labels = {}, by = 1) { const k = key(name, l); counters.set(k, (counters.get(k) || 0) + by); },
  observe(name: string, v: number, l: Labels = {}) { const k = key(name, l); const s = sums.get(k) || { n: 0, sum: 0, max: 0 }; s.n++; s.sum += v; s.max = Math.max(s.max, v); sums.set(k, s); },
  render() {
    const out: string[] = [];
    for (const [k, v] of counters) out.push(`tessera_${k} ${v}`);
    for (const [k, s] of sums) { const [n, l] = k.split('{'); out.push(`tessera_${n}_count{${l} ${s.n}`, `tessera_${n}_sum{${l} ${s.sum.toFixed(1)}`, `tessera_${n}_max{${l} ${s.max.toFixed(1)}`); }
    out.push(`tessera_process_uptime_seconds ${Math.round(process.uptime())}`);
    return out.join('\n') + '\n';
  },
};
export function logLine(o: Record<string, unknown>) { if (process.env.TESSERA_QUIET === '1') return; process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n'); }
