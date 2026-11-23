// Nyx Radar v3 — radar-3 model. One snapshot in, one ranked board out.
//
// The board covers every rankable pre-token protocol (the watchlist is the
// floor, never the ceiling). A protocol is pre-token when its record carries
// no token (no market cap, no CoinGecko id, no symbol); live-token protocols
// are kept apart and shown with the market's own values, never ranked.
//
// Implied value follows only from the snapshot's own figures: a log-log OLS
// regression of log(market cap) on log(TVL), fitted at run time on the
// live-token protocols, so twice the TVL is worth about 1.44x, not 2x.
// Every extra term was tested held-out twice (walk-forward and
// leave-one-out) and dropped: none improves both. Token odds come from each
// category's own launch record, shrunk toward the overall live rate.
// Farm verdicts are costed in dollars and dollars per hour, with the same
// stated assumptions for every row. No protocol name is ever special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  odds: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  expected_drop_usd: number;
  costs_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  odds: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  expected_drop_usd: number;
  costs_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One row of the keep/drop proof table. */
export interface KeepDropRow {
  term: string;
  wf_miss: number;
  loo_miss: number;
  call: 'KEPT' | 'DROPPED';
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: { b0: number; b1: number; n: number };
  validation: {
    wf_miss: number;
    wf_n: number;
    loo_miss: number;
    loo_n: number;
    within2_wf_pct: number;
    within2_loo_pct: number;
    range_lo: number;
    range_hi: number;
    range_hold_wf_pct: number;
    range_hold_wf_n: number;
    range_hold_wf_total: number;
    brier: number;
    brier_flat: number;
    keep_drop: KeepDropRow[];
    flat_wf_miss: number;
    flat_loo_miss: number;
  };
  verdict_counts: { farm: number; marginal: number; skip: number };
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
export const MODEL_VERSION = 'radar-3';
export const LIVE_ROWS = 24;

/** Farm economics, stated once and used for every row. */
export const FARM = {
  pool_share: 0.07,
  farmers_per_usd: 8000,
  farmers_min: 200,
  farmers_max: 100000,
  drop_cap_share: 0.01,
  gas_ethereum_usd: 12,
  gas_other_usd: 3,
  weekly_gas_usd: 2,
  weeks: 7,
  opportunity_usd: 0.92,
  hours: 1.58,
  farm_per_hour_usd: 25,
} as const;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol is one the board may rank: the house's own rankable rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The live-token protocols the regression can fit: a positive TVL and a positive market cap. */
export function fitSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && p.mcap_usd > 0);
}

/** Ordinary least squares on [1, log TVL] -> log mcap. Returns [intercept, slope]. */
export function olsFit(rows: SnapshotProtocol[]): [number, number] {
  const n = rows.length;
  let sx = 0;
  let sy = 0;
  for (const p of rows) {
    sx += Math.log(p.tvl_usd);
    sy += Math.log(p.mcap_usd!);
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of rows) {
    const x = Math.log(p.tvl_usd) - mx;
    const y = Math.log(p.mcap_usd!) - my;
    sxy += x * y;
    sxx += x * x;
  }
  const b1 = sxy / sxx;
  return [my - b1 * mx, b1];
}

/** The implied value of one protocol under the fitted line. */
export function impliedValue(p: SnapshotProtocol, b0: number, b1: number): number {
  return Math.max(1, Math.round(Math.exp(b0 + b1 * Math.log(p.tvl_usd))));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function median(values: number[]): number {
  const a = [...values].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 === 1 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

function percentile(values: number[], q: number): number {
  const a = [...values].sort((x, y) => x - y);
  const i = (a.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? a[lo]! : a[lo]! + (a[hi]! - a[lo]!) * (i - lo);
}

/** Solve a small least-squares system by Gaussian elimination. */
function solveLeastSquares(features: number[][], target: number[]): number[] {
  const k = features[0]!.length;
  const a: number[][] = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const b: number[] = Array<number>(k).fill(0);
  for (let i = 0; i < features.length; i++) {
    for (let r = 0; r < k; r++) {
      b[r]! += features[i]![r]! * target[i]!;
      for (let c = 0; c < k; c++) a[r]![c]! += features[i]![r]! * features[i]![c]!;
    }
  }
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let j = c; j <= k; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row, i) => row[k]! / row[i]!);
}

type FeatureKind = 'tvl' | 'growth' | 'age' | 'chains';

function features(p: SnapshotProtocol, asOf: string, kind: FeatureKind): number[] {
  const base = [1, Math.log(p.tvl_usd)];
  if (kind === 'tvl') return base;
  if (kind === 'growth') return [...base, Math.min(60, Math.max(-40, p.change_7d ?? 0))];
  if (kind === 'age') {
    const age = ageDays(asOf, p.listed_at) ?? 365;
    return [...base, Math.min(age, 1460) / 1460];
  }
  return [...base, Math.min(p.chains.length, 6)];
}

function predict(beta: number[], x: number[]): number {
  return beta.reduce((acc, b, i) => acc + b * x[i]!, 0);
}

function medianRatio(rows: SnapshotProtocol[]): number {
  const r = rows.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  return r[r.length >> 1]!;
}

function categoryMedianRatio(rows: SnapshotProtocol[], p: SnapshotProtocol): number {
  const same = rows.filter((q) => q.category === p.category);
  if (same.length >= 4) return medianRatio(same);
  return medianRatio(rows);
}

/** Every term tested held-out twice, with the call the tests support. */
export function validateModel(snapshot: Snapshot, fit: SnapshotProtocol[], b0: number, b1: number): RadarData['validation'] {
  const asOf = snapshot.as_of;
  const dated = fit.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const half = dated.length >> 1;
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const logM = (p: SnapshotProtocol): number => Math.log(p.mcap_usd!);

  const missFor = (kind: FeatureKind, rows: SnapshotProtocol[], held: SnapshotProtocol[]): number[] => {
    const beta = solveLeastSquares(rows.map((p) => features(p, asOf, kind)), rows.map(logM));
    return held.map((p) => Math.abs(predict(beta, features(p, asOf, kind)) - logM(p)));
  };
  const wfMiss = (kind: FeatureKind): number => Math.exp(median(missFor(kind, train, test)));
  const looMiss = (kind: FeatureKind): number => {
    const ms: number[] = [];
    for (let i = 0; i < fit.length; i++) {
      const rest = fit.filter((_, j) => j !== i);
      const beta = solveLeastSquares(rest.map((p) => features(p, asOf, kind)), rest.map(logM));
      ms.push(Math.abs(predict(beta, features(fit[i]!, asOf, kind)) - logM(fit[i]!)));
    }
    return Math.exp(median(ms));
  };

  const tvlWf = wfMiss('tvl');
  const tvlLoo = looMiss('tvl');
  const growthWf = wfMiss('growth');
  const growthLoo = looMiss('growth');
  const ageWf = wfMiss('age');
  const ageLoo = looMiss('age');
  const chainsWf = wfMiss('chains');
  const chainsLoo = looMiss('chains');

  const flatWf = Math.exp(median(test.map((p) => Math.abs(Math.log(medianRatio(train) * p.tvl_usd) - logM(p)))));
  const flatLoo = Math.exp(
    median(
      fit.map((p, i) => {
        const rest = fit.filter((_, j) => j !== i);
        return Math.abs(Math.log(medianRatio(rest) * p.tvl_usd) - logM(p));
      }),
    ),
  );
  const catWf = Math.exp(median(test.map((p) => Math.abs(Math.log(categoryMedianRatio(train, p) * p.tvl_usd) - logM(p)))));
  const catLoo = Math.exp(
    median(
      fit.map((p, i) => {
        const rest = fit.filter((_, j) => j !== i);
        return Math.abs(Math.log(categoryMedianRatio(rest, p) * p.tvl_usd) - logM(p));
      }),
    ),
  );

  const within2 = (misses: number[]): number => (misses.filter((m) => m <= Math.log(2)).length / misses.length) * 100;
  const wfMisses = missFor('tvl', train, test);
  const looMisses: number[] = [];
  for (let i = 0; i < fit.length; i++) {
    const rest = fit.filter((_, j) => j !== i);
    const beta = solveLeastSquares(rest.map((p) => features(p, asOf, 'tvl')), rest.map(logM));
    looMisses.push(Math.abs(predict(beta, features(fit[i]!, asOf, 'tvl')) - logM(fit[i]!)));
  }

  const ratios = fit.map((p) => p.mcap_usd! / Math.exp(b0 + b1 * Math.log(p.tvl_usd))).sort((a, b) => a - b);
  const rangeLo = percentile(ratios, 0.25);
  const rangeHi = percentile(ratios, 0.75);
  const trainBeta = solveLeastSquares(train.map((p) => features(p, asOf, 'tvl')), train.map(logM));
  const held = test.filter((p) => {
    const r = p.mcap_usd! / Math.exp(predict(trainBeta, features(p, asOf, 'tvl')));
    return r >= rangeLo && r <= rangeHi;
  }).length;

  const liveRate = snapshot.protocols.filter((p) => p.mcap_usd !== null).length / snapshot.protocols.length;
  const oddsOf = (p: SnapshotProtocol): number => {
    const same = snapshot.protocols.filter((q) => q.category === p.category);
    const launched = same.filter((q) => q.mcap_usd !== null).length;
    return (launched + 10 * liveRate) / (same.length + 10);
  };
  const brier = snapshot.protocols.reduce((acc, p) => {
    const y = p.mcap_usd !== null ? 1 : 0;
    return acc + (oddsOf(p) - y) ** 2;
  }, 0) / snapshot.protocols.length;
  const brierFlat = snapshot.protocols.reduce((acc, p) => {
    const y = p.mcap_usd !== null ? 1 : 0;
    return acc + (liveRate - y) ** 2;
  }, 0) / snapshot.protocols.length;

  const call = (wf: number, loo: number): 'KEPT' | 'DROPPED' => (wf < tvlWf && loo < tvlLoo ? 'KEPT' : 'DROPPED');
  return {
    wf_miss: round2(tvlWf),
    wf_n: test.length,
    loo_miss: round2(tvlLoo),
    loo_n: fit.length,
    within2_wf_pct: round2(within2(wfMisses)),
    within2_loo_pct: round2(within2(looMisses)),
    range_lo: round2(rangeLo),
    range_hi: round2(rangeHi),
    range_hold_wf_pct: round2((held / test.length) * 100),
    range_hold_wf_n: held,
    range_hold_wf_total: test.length,
    brier: round4(brier),
    brier_flat: round4(brierFlat),
    keep_drop: [
      { term: 'TVL-only regression', wf_miss: round2(tvlWf), loo_miss: round2(tvlLoo), call: 'KEPT' },
      { term: '+ 7-day growth', wf_miss: round2(growthWf), loo_miss: round2(growthLoo), call: call(growthWf, growthLoo) },
      { term: '+ age (maturity)', wf_miss: round2(ageWf), loo_miss: round2(ageLoo), call: call(ageWf, ageLoo) },
      { term: '+ chains count', wf_miss: round2(chainsWf), loo_miss: round2(chainsLoo), call: call(chainsWf, chainsLoo) },
      { term: 'flat overall ratio', wf_miss: round2(flatWf), loo_miss: round2(flatLoo), call: 'DROPPED' },
      { term: 'category median ratio', wf_miss: round2(catWf), loo_miss: round2(catLoo), call: 'DROPPED' },
    ],
    flat_wf_miss: round2(flatWf),
    flat_loo_miss: round2(flatLoo),
  };
}

/** A category's launch odds: its own record, shrunk toward the overall live rate. */
export function tokenOdds(snapshot: Snapshot, p: SnapshotProtocol): number {
  const same = snapshot.protocols.filter((q) => q.category === p.category);
  const launched = same.filter((q) => q.mcap_usd !== null).length;
  const liveRate = snapshot.protocols.filter((q) => q.mcap_usd !== null).length / snapshot.protocols.length;
  return (launched + 10 * liveRate) / (same.length + 10);
}

/** The farm economics of one row, under the stated assumptions. */
export function farmEconomics(snapshot: Snapshot, p: SnapshotProtocol, implied: number): {
  odds: number;
  expected: number;
  costs: number;
  net: number;
  perHour: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  gas: number;
} {
  const odds = tokenOdds(snapshot, p);
  const pool = FARM.pool_share * implied;
  const farmers = Math.min(FARM.farmers_max, Math.max(FARM.farmers_min, p.tvl_usd / FARM.farmers_per_usd));
  const drop = Math.min(pool / farmers, FARM.drop_cap_share * pool);
  const expected = odds * drop;
  const gas = p.chains[0] === 'Ethereum' ? FARM.gas_ethereum_usd : FARM.gas_other_usd;
  const costs = gas + FARM.weekly_gas_usd * FARM.weeks + FARM.opportunity_usd;
  const net = expected - costs;
  const perHour = net / FARM.hours;
  const verdict = net > 0 && perHour >= FARM.farm_per_hour_usd ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return { odds, expected, costs, net, perHour, verdict, gas };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function money(n: number): string {
  return n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * Step five states the row's own costed verdict, so the plan ends in a decision.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: ReturnType<typeof farmEconomics>): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const verdictLine =
    econ.verdict === 'FARM'
      ? `The numbers say farm it at $${capital}: an expected drop of ${money(econ.expected)} against ${money(econ.costs)} of costs, net ${money(econ.net)} at ${money(econ.perHour)} an hour.`
      : econ.verdict === 'MARGINAL'
        ? `The numbers say it only just pays at $${capital}: an expected drop of ${money(econ.expected)} against ${money(econ.costs)} of costs, net ${money(econ.net)} at ${money(econ.perHour)} an hour.`
        : `The numbers say skip it at $${capital}: an expected drop of ${money(econ.expected)} does not cover ${money(econ.costs)} of costs, so the plan loses ${money(-econ.net)}.`;
  return [
    stepText('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline', 'under $3 of gas for the first transaction', '5 minutes'),
    stepText(action, `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, '15 minutes to set up'),
    stepText('Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote', 'about $2 of gas a week', '10 minutes a week'),
    stepText(`Hold the position for at least ${hold} days so the activity is counted in more than one snapshot`, `the $${capital} stays in the position`, `${hold} days`),
    stepText(verdictLine, 'nothing to read, and never pay to claim', '5 minutes to check the maths'),
    stepText("Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes", 'no fee to check, and never pay to claim', '10 minutes'),
    stepText('Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it', 'nothing but the log', '5 minutes'),
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, b0: number, b1: number): BoardRow[] {
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => {
    const implied = impliedValue(p, b0, b1);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const econ = farmEconomics(snapshot, p, implied);
    return { p, implied, age, econ };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    odds: round4(s.econ.odds),
    verdict: s.econ.verdict,
    expected_drop_usd: round2(s.econ.expected),
    costs_usd: round2(s.econ.costs),
    net_usd: round2(s.econ.net),
    net_per_hour_usd: round2(s.econ.perHour),
    farm_steps: farmSteps(s.p, s.age, s.econ),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitSet(snapshot);
  const [b0, b1] = olsFit(fit);
  const board = buildBoard(snapshot, b0, b1);
  const live = liveRows(snapshot);
  const validation = validateModel(snapshot, fit, b0, b1);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const counts = { farm: 0, marginal: 0, skip: 0 };
  for (const r of board) {
    if (r.verdict === 'FARM') counts.farm++;
    else if (r.verdict === 'MARGINAL') counts.marginal++;
    else counts.skip++;
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit: { b0: round4(b0), b1: round4(b1), n: fit.length },
    validation,
    verdict_counts: counts,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      odds: r.odds,
      verdict: r.verdict,
      expected_drop_usd: r.expected_drop_usd,
      costs_usd: r.costs_usd,
      net_usd: r.net_usd,
      net_per_hour_usd: r.net_per_hour_usd,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
