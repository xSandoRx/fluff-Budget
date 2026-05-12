const DEFAULT_STATE = {
  capital: { cash: 0, invested: 0, reserve: 0 },
  target: 50000,
  monthlySavings: 800,
  rules: {
    maxPortfolioLossPct: 0.15,
    marketBuyMoreDrawdown: 0.20,
    marketRiskOffDrawdown: 0.30,
    profitTrimPct: 0.40,
    stopLossPct: 0.30,
    trendReviewPct: 0.12,
    monthlySafe: 700,
    monthlyRisk: 100,
    overCapBuffer: 0.10,
    longTermDays: 366,
    taxCautionDays: 330
  },
  tiers: {
    CORE:    { maxPosPct: 0.45, maxTierPct: 0.60, dip1: 0.20, dip2: 0.30, dip3: 0.40, buy: 250 },
    QUALITY: { maxPosPct: 0.10, maxTierPct: 0.20, dip1: 0.25, dip2: 0.35, dip3: 0.45, buy: 100 },
    THEME:   { maxPosPct: 0.06, maxTierPct: 0.20, dip1: 0.40, dip2: 0.55, dip3: 0.70, buy:  75 },
    SPEC:    { maxPosPct: 0.04, maxTierPct: 0.15, dip1: 0.55, dip2: 0.65, dip3: 0.75, buy:  50 }
  },
  holdings: [],
  transactions: [],
  expanded: {},
  history: []
};

const clone = o => JSON.parse(JSON.stringify(o));
const safeNum = n => { const x = Number(n); return Number.isFinite(x) ? x : 0; };
const today = () => new Date().toISOString().slice(0, 10);
const money = n => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = n => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct1 = n => `${(Number(n || 0) * 100).toFixed(1)}%`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let state = loadState();
let editIndex = null;
let activeTxTicker = null;
let activeBackfillIndex = null;

function mergeDefaults(d, s) {
  const m = clone(d);
  if (!s || typeof s !== 'object') return m;
  return {
    ...m, ...s,
    capital: { ...m.capital, ...(s.capital || {}) },
    rules:   { ...m.rules,   ...(s.rules   || {}) },
    tiers:   { ...m.tiers,   ...(s.tiers   || {}) },
    holdings:     Array.isArray(s.holdings)     ? s.holdings     : [],
    transactions: Array.isArray(s.transactions) ? s.transactions : [],
    expanded: s.expanded || {},
    history:  Array.isArray(s.history) ? s.history : []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem('driftBudgetState') || localStorage.getItem('houseFundState') || '{}';
    return mergeDefaults(DEFAULT_STATE, JSON.parse(raw));
  } catch {
    return clone(DEFAULT_STATE);
  }
}

function saveState() {
  localStorage.setItem('driftBudgetState', JSON.stringify(state));
}

function showToast(msg = 'Saved') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.add('hidden'), 1800);
}

// ---------- Lots / derived holdings ----------

function latestTx(ticker) {
  return state.transactions
    .filter(t => t.ticker === ticker)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

function hasBuyTx(ticker) {
  return state.transactions.some(t => t.ticker === ticker && t.type === 'BUY');
}

function ensureBaselineLot(ticker) {
  const h = state.holdings.find(x => x.ticker === ticker);
  if (!h || hasBuyTx(ticker)) return;
  const shares = safeNum(h.shares);
  const price = safeNum(h.costBasis);
  const date = h.purchaseDate || today();
  if (shares > 0 && price > 0) {
    state.transactions.push({ date, type: 'BUY', ticker, shares, price, tier: h.tier || 'SPEC', synthetic: true });
  }
}

function lotsFor(ticker) {
  const tx = state.transactions
    .filter(t => t.ticker === ticker)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const lots = [];
  let realized = 0;
  for (const t of tx) {
    if (t.type === 'BUY') {
      lots.push({ date: t.date, shares: safeNum(t.shares), price: safeNum(t.price) });
    }
    if (t.type === 'SELL') {
      let qty = safeNum(t.shares);
      const sell = safeNum(t.price);
      while (qty > 0 && lots.length) {
        const lot = lots[0];
        const used = Math.min(qty, lot.shares);
        realized += used * (sell - lot.price);
        lot.shares -= used;
        qty -= used;
        if (lot.shares <= 1e-9) lots.shift();
      }
    }
  }
  return { lots, realized };
}

function deriveHoldings() {
  const by = {};
  for (const t of state.transactions) {
    if (!['BUY', 'SELL'].includes(t.type)) continue;
    const k = t.ticker;
    if (!by[k]) {
      by[k] = { ticker: k, apiSymbol: k, tier: t.tier || 'SPEC', price: 0, high52: 0, shortHigh: 0, spark: [], lastUpdated: 'Refresh needed' };
    }
    if (t.tier) by[k].tier = t.tier;
  }
  for (const h of state.holdings) {
    if (!by[h.ticker]) {
      by[h.ticker] = h;
    } else {
      by[h.ticker] = {
        ...h,
        ...by[h.ticker],
        price: h.price,
        high52: h.high52,
        shortHigh: h.shortHigh,
        spark: h.spark,
        lastUpdated: h.lastUpdated,
        purchaseDate: h.purchaseDate || by[h.ticker].purchaseDate
      };
    }
  }
  return Object.values(by).map(h => {
    const lot = lotsFor(h.ticker);
    const txShares = lot.lots.reduce((s, l) => s + l.shares, 0);
    const legacyShares = safeNum(h.shares);
    const shares = txShares || legacyShares;
    const basis = txShares
      ? lot.lots.reduce((s, l) => s + l.shares * l.price, 0) / txShares
      : safeNum(h.costBasis);
    const first = lot.lots[0]?.date || h.purchaseDate || '';
    return {
      ...h,
      shares,
      costBasis: basis,
      purchaseDate: first,
      realizedGain: lot.realized,
      lots: lot.lots,
      latestTx: latestTx(h.ticker)
    };
  }).filter(h => safeNum(h.shares) > 0 || !state.transactions.length);
}

// ---------- Tax / drawdown / signals ----------

function daysHeld(h) {
  if (!h.purchaseDate) return null;
  return Math.floor((Date.now() - new Date(h.purchaseDate).getTime()) / 86400000);
}

function taxStatus(h) {
  const d = daysHeld(h);
  if (d === null) return { label: 'Holding period unknown', warn: false };
  if (d >= state.rules.longTermDays) return { label: 'Likely long-term', warn: false };
  if (d >= state.rules.taxCautionDays) return { label: `Near long-term (${state.rules.longTermDays - d}d)`, warn: true };
  return { label: 'Likely short-term', warn: true };
}

function weightedMarketDrawdown(holds = deriveHoldings()) {
  const q = holds.filter(h => ['CORE', 'QUALITY'].includes(h.tier) && h.high52);
  if (!q.length) return 0;
  return q.reduce((s, h) => s + Math.max(0, 1 - h.price / h.high52), 0) / q.length;
}

function trimPlan(value, maxValue, shares, price) {
  const excess = Math.max(0, value - maxValue);
  const buffer = safeNum(state.rules.overCapBuffer) || 0;
  const targetTrim = excess * (1 + buffer);
  const sharesToSell = price ? Math.min(shares, targetTrim / price) : 0;
  let severity = 'None';
  if (excess > 0) {
    const over = maxValue ? value / maxValue - 1 : 1;
    severity = over > 0.75 ? 'Heavy Trim' : over > 0.25 ? 'Moderate Trim' : 'Light Trim';
  }
  return { excess, targetTrim, sharesToSell, severity, riskReduction: targetTrim * 0.5 };
}

function decisionLabel(h, plan, profit, shortDraw, tax) {
  if (plan.excess > 0) return `${plan.severity}: sell about ${plan.sharesToSell.toFixed(2)} sh (${money(plan.targetTrim)})`;
  if (h.costBasis && profit <= -state.rules.stopLossPct) return `Review thesis: loss ${pct1(profit)}. Do not auto-sell.`;
  if (h.costBasis && profit >= state.rules.profitTrimPct) return tax.warn ? 'Profit review: consider tax timing before selling' : 'Profit review: optional partial harvest';
  if (shortDraw >= state.rules.trendReviewPct) return 'Trend review: avoid adding until recovery';
  return 'Hold / accumulate by rules';
}

function enrichHolding(h, total, regime, estimatedLossRisk, lossBudget) {
  const tier = state.tiers[h.tier] || state.tiers.SPEC;
  const value = safeNum(h.shares) * safeNum(h.price);
  const posPct = total ? value / total : 0;
  const maxValue = total * safeNum(tier.maxPosPct);
  const draw52 = h.high52 ? Math.max(0, 1 - h.price / h.high52) : 0;
  const shortDraw = h.shortHigh ? Math.max(0, 1 - h.price / h.shortHigh) : 0;
  const profit = h.costBasis ? (h.price - h.costBasis) / h.costBasis : 0;
  const plan = trimPlan(value, maxValue, safeNum(h.shares), safeNum(h.price));
  const tax = taxStatus(h);
  const blocked = regime === 'RISK-OFF' || estimatedLossRisk > lossBudget || value > maxValue;
  const buy = blocked ? 0
    : draw52 >= tier.dip3 ? tier.buy * 3
    : draw52 >= tier.dip2 ? tier.buy * 2
    : draw52 >= tier.dip1 ? tier.buy
    : 0;
  let action = buy > 0 ? 'BUY' : 'HOLD';
  if (plan.excess > 0) action = 'TRIM';
  else if (h.costBasis && profit <= -state.rules.stopLossPct) action = 'REVIEW';
  else if (h.costBasis && profit >= state.rules.profitTrimPct) action = 'PROFIT REVIEW';
  else if (shortDraw >= state.rules.trendReviewPct) action = 'WATCH';
  return { ...h, value, posPct, maxValue, draw52, shortDraw, profit, buy, trimPlan: plan, tax, action, decision: decisionLabel(h, plan, profit, shortDraw, tax) };
}

function calc() {
  const baseHoldings = deriveHoldings();
  const stockValue = baseHoldings.reduce((s, h) => s + safeNum(h.shares) * safeNum(h.price), 0);
  const portfolio = safeNum(state.capital.cash) + safeNum(state.capital.invested) + safeNum(state.capital.reserve) + stockValue;
  const riskAssets = safeNum(state.capital.invested) + stockValue;
  const riskPct = portfolio ? riskAssets / portfolio : 0;
  const lossBudget = portfolio * safeNum(state.rules.maxPortfolioLossPct);
  const estimatedLossRisk = stockValue * 0.5;
  const marketDrawdownProxy = weightedMarketDrawdown(baseHoldings);
  let regime = 'NORMAL';
  if (marketDrawdownProxy >= state.rules.marketRiskOffDrawdown) regime = 'RISK-OFF';
  else if (marketDrawdownProxy >= state.rules.marketBuyMoreDrawdown) regime = 'SELECTIVE';
  let glide = 'ACCUMULATE';
  if (portfolio >= state.target) glide = 'TARGET MET';
  else if (portfolio >= state.target * 0.9) glide = 'PROTECT';
  else if (portfolio >= state.target * 0.8) glide = 'SLOW RISK';
  const holdings = baseHoldings.map(h => enrichHolding(h, portfolio, regime, estimatedLossRisk, lossBudget));
  return { portfolio, stockValue, riskAssets, riskPct, lossBudget, estimatedLossRisk, marketDrawdownProxy, regime, glide, holdings };
}

// ---------- Safe-to-deploy budget ----------

function safeDeploy(c) {
  const baseDeploy = safeNum(state.rules.monthlyRisk);
  const lossHeadroom = Math.max(0, c.lossBudget - c.estimatedLossRisk);
  // a fresh buy adds ~50% of its $ amount to estimated loss-at-risk, so headroom*2 caps the buy size
  const lossCap = lossHeadroom * 2;
  const regimeMult = c.regime === 'RISK-OFF' ? 0 : c.regime === 'SELECTIVE' ? 0.5 : 1;
  const cap = Math.min(baseDeploy, lossCap);
  const safe = Math.max(0, cap * regimeMult);
  let reason;
  if (regimeMult === 0) reason = 'Market regime is RISK-OFF — pause new buys.';
  else if (lossCap < baseDeploy) reason = `Capped by loss-budget headroom (${money(lossHeadroom)} left of ${money(c.lossBudget)}).`;
  else reason = `Using your monthlyRisk rule (${money(baseDeploy)}).`;
  return { safe, baseDeploy, lossHeadroom, lossCap, regimeMult, reason };
}

// ---------- Price fetch (Yahoo via corsproxy.io, no key) ----------

async function fetchDaily(symbol) {
  const yahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const url = `https://corsproxy.io/?url=${encodeURIComponent(yahoo)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const err = data?.chart?.error?.description || 'Symbol not found';
    throw new Error(err);
  }
  const meta = result.meta || {};
  const ts = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const highs = quote.high || [];
  const valid = ts
    .map((t, i) => ({ t, close: closes[i], high: highs[i] }))
    .filter(v => Number.isFinite(v.close));
  if (!valid.length) throw new Error('No daily data');
  const latest = valid[valid.length - 1];
  const allHighs = valid.map(v => safeNum(v.high) || safeNum(v.close)).filter(Boolean);
  const last30 = valid.slice(-30).map(v => safeNum(v.close));
  return {
    price: safeNum(meta.regularMarketPrice ?? latest.close),
    high52: safeNum(meta.fiftyTwoWeekHigh) || (allHighs.length ? Math.max(...allHighs) : 0),
    shortHigh: last30.length ? Math.max(...last30) : 0,
    spark: last30,
    lastUpdated: new Date(latest.t * 1000).toISOString().slice(0, 10)
  };
}

async function refreshPrices() {
  const status = document.getElementById('apiStatus');
  const errors = [];
  const holds = deriveHoldings();
  if (!holds.length) {
    if (status) status.textContent = 'No holdings to refresh.';
    return;
  }
  for (let i = 0; i < holds.length; i++) {
    const h = holds[i];
    if (status) status.textContent = `Refreshing ${h.ticker} (${i + 1}/${holds.length})…`;
    try {
      const quote = await fetchDaily(h.apiSymbol || h.ticker);
      const idx = state.holdings.findIndex(x => x.ticker === h.ticker);
      if (idx >= 0) state.holdings[idx] = { ...state.holdings[idx], ...quote };
      else state.holdings.push({ ...h, ...quote });
      saveState();
    } catch (e) {
      errors.push(`${h.ticker}: ${e.message}`);
    }
    await sleep(250);
  }
  takeSnapshot('price refresh');
  if (status) status.textContent = errors.length ? errors.join(' | ') : `Updated ${new Date().toLocaleTimeString()}`;
  render();
  showToast(errors.length ? 'Refresh finished with errors' : 'Prices refreshed');
}

// ---------- Chart helpers ----------

function sparkline(vals, trend = 'up', cls = 'spark') {
  if (!vals || vals.length < 2) return `<svg class="${cls}" viewBox="0 0 120 44"></svg>`;
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const pts = vals.map((v, i) => `${i * (120 / (vals.length - 1))},${42 - ((v - min) / range) * 36}`).join(' ');
  return `<svg class="${cls} ${trend}" viewBox="0 0 120 44" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
}

function actionClass(a) {
  return a === 'BUY' ? 'buy'
    : (a === 'TRIM' || a === 'PROFIT REVIEW') ? 'trim'
    : a === 'REVIEW' ? 'stop'
    : 'hold';
}

// ---------- History / analytics ----------

function takeSnapshot(note = 'manual') {
  const c = calc();
  const day = today();
  const snap = {
    date: day, ts: Date.now(), portfolio: c.portfolio, riskAssets: c.riskAssets,
    riskPct: c.riskPct, stockValue: c.stockValue, estimatedLossRisk: c.estimatedLossRisk, note
  };
  const idx = state.history.findIndex(h => h.date === day);
  if (idx >= 0) state.history[idx] = snap;
  else state.history.push(snap);
  state.history = state.history.slice(-365);
  saveState();
}

function analytics() {
  const h = [...state.history].sort((a, b) => a.ts - b.ts);
  if (!h.length) return { series: [], change: 0, changePct: 0, maxDD: 0, best: 0, worst: 0 };
  const vals = h.map(x => x.portfolio);
  const rets = [];
  for (let i = 1; i < vals.length; i++) rets.push(vals[i - 1] ? vals[i] / vals[i - 1] - 1 : 0);
  let peak = vals[0], maxDD = 0;
  vals.forEach(v => { peak = Math.max(peak, v); maxDD = Math.min(maxDD, v / peak - 1); });
  return {
    series: vals,
    change: vals.at(-1) - vals[0],
    changePct: vals[0] ? vals.at(-1) / vals[0] - 1 : 0,
    maxDD,
    best: rets.length ? Math.max(...rets) : 0,
    worst: rets.length ? Math.min(...rets) : 0
  };
}

// ---------- Render ----------

function render() {
  const c = calc();
  const sd = safeDeploy(c);
  document.getElementById('totalFund').textContent = money(c.portfolio);
  document.getElementById('riskAssetsValue').textContent = money(c.riskAssets);
  document.getElementById('riskPct').textContent = pct1(c.riskPct);
  document.getElementById('targetValue').textContent = money(state.target);
  document.getElementById('lossBudget').textContent = money(c.lossBudget);
  document.getElementById('progressBar').style.width = `${Math.min(100, c.portfolio / state.target * 100)}%`;
  const months = state.monthlySavings > 0 ? Math.max(0, Math.ceil((state.target - c.portfolio) / state.monthlySavings)) : 0;
  document.getElementById('targetDate').textContent = `${months} mo to target`;
  document.getElementById('marketRegime').textContent = c.regime;
  document.getElementById('marketMode').textContent = c.glide;
  document.getElementById('marketRegimeNote').textContent = `Market proxy drawdown ${pct1(c.marketDrawdownProxy)}`;
  document.getElementById('riskStatus').textContent = c.estimatedLossRisk > c.lossBudget ? 'RISK HIGH' : 'GOOD';
  document.getElementById('riskNote').textContent = `Loss at risk ${money(c.estimatedLossRisk)} of ${money(c.lossBudget)} budget`;
  document.getElementById('monthlyRouting').textContent = c.regime === 'RISK-OFF' ? 'Safer assets only' : `${money(state.rules.monthlySafe)} safe / ${money(state.rules.monthlyRisk)} risk`;
  renderSafeDeploy(sd, c);
  renderHoldings(c.holdings, sd);
  renderSignals(c.holdings, c, sd);
  renderInputs();
  renderRules();
  renderAnalytics();
}

function renderSafeDeploy(sd, c) {
  const el = document.getElementById('safeDeploy');
  if (!el) return;
  el.innerHTML = `
    <div class="sectionTitle">Safe to Deploy This Month</div>
    <div class="overviewGrid">
      <div><span>Buy budget now</span><strong class="green">${money(sd.safe)}</strong></div>
      <div><span>Loss-budget headroom</span><strong>${money(sd.lossHeadroom)}</strong><small>caps buys at ${money(sd.lossCap)}</small></div>
      <div><span>Monthly risk rule</span><strong>${money(sd.baseDeploy)}</strong></div>
      <div><span>Regime multiplier</span><strong>${(sd.regimeMult * 100).toFixed(0)}%</strong><small>${c.regime}</small></div>
    </div>
    <p class="muted" style="margin-top:10px">${sd.reason}</p>`;
}

function txText(t) {
  return t ? `${t.date} · ${t.type} ${t.shares} @ ${money2(t.price)}${t.synthetic ? ' · baseline' : ''}` : 'None';
}

function renderHoldings(holdings, sd) {
  const el = document.getElementById('holdingsList');
  el.innerHTML = holdings.length ? holdings.map((h, i) => {
    const expanded = !!state.expanded[h.ticker];
    const trend = h.spark && h.spark[h.spark.length - 1] >= h.spark[0] ? 'up' : 'down';
    const trim = h.trimPlan;
    const buyShare = sd && sd.safe > 0 && h.buy > 0 ? Math.min(h.buy, sd.safe) : 0;
    const buyNote = h.buy > 0
      ? `Suggests $${h.buy.toLocaleString()} (uses ${sd && sd.safe > 0 ? Math.round((buyShare / sd.safe) * 100) : 0}% of monthly buy budget)`
      : '';
    return `<article class="holdingCard ${expanded ? 'expanded' : ''}">
      <button class="cardToggle" data-toggle="${h.ticker}">
        <div class="tickerBlock"><div class="logoBubble">${h.ticker.slice(0, 1)}</div><div><h3>${h.ticker}</h3><span class="tier ${h.tier}">${h.tier}</span></div></div>
        <div class="priceBlock"><span>Price</span><strong>${money2(h.price)}</strong><small class="${h.profit >= 0 ? 'green' : 'red'}">${pct1(h.profit)}</small></div>
        <div class="sparkBlock"><span>30D</span>${sparkline(h.spark, trend)}</div>
        <div class="actionBlock"><span>Decision</span><b class="action ${actionClass(h.action)}">${h.action}</b><small>${h.decision}</small>${buyNote ? `<small class="muted">${buyNote}</small>` : ''}</div>
        <span class="chev">${expanded ? '⌄' : '›'}</span>
      </button>
      ${expanded ? `<div class="detailGrid">
        <div><span>Shares</span><strong>${h.shares.toFixed(4)}</strong></div>
        <div><span>FIFO Basis</span><strong>${money2(h.costBasis)}</strong></div>
        <div><span>Oldest Lot Date</span><strong>${h.purchaseDate || 'Unknown'}</strong></div>
        <div><span>Lots</span><strong>${h.lots?.length || 0}</strong></div>
        <div><span>Latest Tx</span><strong>${txText(h.latestTx)}</strong></div>
        <div><span>Realized P/L</span><strong class="${h.realizedGain >= 0 ? 'green' : 'red'}">${money(h.realizedGain || 0)}</strong></div>
        <div><span>Tax Flag</span><strong>${h.tax.label}</strong></div>
        <div><span>Market Value</span><strong>${money(h.value)}</strong></div>
        <div><span>Position</span><strong>${pct1(h.posPct)}</strong></div>
        <div><span>Suggested Trim</span><strong>${trim.excess > 0 ? money(trim.targetTrim) : '$0'}</strong></div>
        <button class="secondary" data-tx="${h.ticker}">Add Tx</button>
        <button class="secondary" data-backfill="${i}">Backfill Date</button>
        <button class="secondary" data-edit="${i}">Edit Tier/Date</button>
        <button class="danger" data-remove="${i}">Remove</button>
      </div>` : ''}
    </article>`;
  }).join('') : '<article class="emptyCard">No holdings yet. Tap + Add Holding.</article>';
}

function alertHtml(items, empty = 'None') {
  return items.length ? items.map(x => `<div class="alert">${x}</div>`).join('') : `<p class="muted">${empty}</p>`;
}

function renderSignals(holdings, c, sd) {
  const buys = holdings.filter(h => h.buy > 0).map(h => {
    const fits = sd.safe > 0 ? Math.min(h.buy, sd.safe) : 0;
    const note = sd.safe <= 0 ? ' · monthly buy budget = $0' : ` · fits ${money(fits)} of monthly budget`;
    return `${h.ticker}: rules say buy up to ${money(h.buy)} (${pct1(h.draw52)} 52W drawdown)${note}`;
  });
  const sells = holdings.filter(h => h.action !== 'HOLD' && h.action !== 'BUY').map(h => `${h.ticker}: ${h.decision}${h.tax.warn ? ' · tax flag: ' + h.tax.label : ''}`);
  const top = [];
  if (sd.safe <= 0 && c.regime !== 'RISK-OFF') top.push('Buy budget exhausted: hold off on new adds until next month or until loss-budget headroom rebuilds.');
  if (c.estimatedLossRisk > c.lossBudget) top.push('Loss budget exceeded: pause new risk.');
  if (c.riskPct > 0.65) top.push('Risk assets are high relative to target capital.');
  top.push(...sells.slice(0, 3), ...buys.slice(0, 3));
  document.getElementById('buySignals').innerHTML = alertHtml(buys);
  document.getElementById('sellSignals').innerHTML = alertHtml(sells);
  document.getElementById('topAlerts').innerHTML = alertHtml(top);
}

function renderAnalytics() {
  let box = document.getElementById('analyticsBox');
  if (!box) {
    const dash = document.getElementById('dashboard');
    box = document.createElement('article');
    box.className = 'panel';
    box.id = 'analyticsBox';
    dash.appendChild(box);
  }
  const a = analytics();
  box.innerHTML = `<div class="sectionTitle">Performance Analytics</div>
    <div class="analyticsGrid">
      <div><span>Total Change</span><strong class="${a.change >= 0 ? 'green' : 'red'}">${money(a.change)}</strong><small>${pct1(a.changePct)}</small></div>
      <div><span>Max Drawdown</span><strong class="red">${pct1(a.maxDD)}</strong></div>
      <div><span>Best Day</span><strong class="green">${pct1(a.best)}</strong></div>
      <div><span>Worst Day</span><strong class="red">${pct1(a.worst)}</strong></div>
    </div>
    <div class="bigChart">${sparkline(a.series, a.change >= 0 ? 'up' : 'down', 'spark big')}</div>
    <button id="snapshotBtn" class="secondary">Take Snapshot</button>
    <button id="clearHistoryBtn" class="ghost">Clear History</button>
    <p class="muted">${state.history.length} saved snapshots. Stored locally only.</p>`;
}

function renderInputs() {
  document.getElementById('apiSettings').innerHTML = `
    <p id="apiStatus" class="muted">Prices come from Yahoo Finance via a public CORS proxy — no API key needed. Click Refresh Prices on the Holdings tab.</p>`;
  document.getElementById('portfolioSettings').innerHTML = `
    <label>Target Amount<input data-key="target" type="number" step="any" value="${state.target}"></label>
    <label>Monthly Savings<input data-key="monthlySavings" type="number" step="any" value="${state.monthlySavings}"></label>
    <label>Safe / Cash Capital<input data-key="capital:cash" type="number" step="any" value="${state.capital.cash}"></label>
    <label>Invested Capital Outside Holdings<input data-key="capital:invested" type="number" step="any" value="${state.capital.invested}"></label>
    <label>Reserve Capital<input data-key="capital:reserve" type="number" step="any" value="${state.capital.reserve}"></label>
    <div class="alert"><strong>Transactions</strong><br>${state.transactions.slice(-8).reverse().map(t => `${t.date} · ${t.type} ${t.shares || ''} ${t.ticker || ''} @ ${money2(t.price || 0)}${t.synthetic ? ' · baseline' : ''}`).join('<br>') || 'No transactions yet.'}</div>`;
}

function renderRules() {
  document.getElementById('ruleInputs').innerHTML = `<div class="alert"><strong>Signal definitions</strong><br>BUY = allowed add amount. TRIM = reduce concentration. REVIEW = thesis check; not automatic sell. PROFIT REVIEW = consider harvesting gains, but check holding period/tax. WATCH = avoid adding until trend improves.</div>`
    + Object.entries(state.rules).map(([k, v]) => `<label>${k}<input data-key="rule:${k}" type="number" step="any" value="${v}"></label>`).join('');
}

// ---------- Add / edit / transaction modals ----------

function isEditMode() {
  return editIndex !== null;
}

function setEditMode(on) {
  const card = document.querySelector('#addModal .modalCard');
  if (!card) return;
  card.classList.toggle('editMode', !!on);
  document.getElementById('addModalTitle').textContent = on ? 'Edit Tier / Date' : 'Add Holding';
  document.getElementById('addHoldingBtn').textContent = on ? 'Save Changes' : 'Add Holding';
}

function addHolding() {
  const ticker = (document.getElementById('newTicker')?.value || '').trim().toUpperCase();
  const shares = safeNum(document.getElementById('newShares')?.value);
  const costBasis = safeNum(document.getElementById('newCostBasis')?.value);
  const date = document.getElementById('newPurchaseDate')?.value || today();
  const tier = document.getElementById('newTier')?.value || 'SPEC';
  if (!ticker || shares <= 0 || costBasis <= 0) {
    alert('Enter ticker, shares, and cost basis.');
    return;
  }
  state.transactions.push({ date, type: 'BUY', ticker, shares, price: costBasis, tier });
  // Only push a new metadata row if this ticker isn't already tracked.
  const existingIdx = state.holdings.findIndex(x => x.ticker === ticker);
  if (existingIdx >= 0) {
    state.holdings[existingIdx] = { ...state.holdings[existingIdx], tier, purchaseDate: state.holdings[existingIdx].purchaseDate || date };
  } else {
    state.holdings.push({ ticker, apiSymbol: ticker, tier, purchaseDate: date, price: 0, high52: 0, shortHigh: 0, spark: [], lastUpdated: 'Refresh needed' });
  }
  state.expanded[ticker] = true;
  saveState();
  takeSnapshot('holding added');
  closeModal();
  render();
  showToast('Holding added');
}

function openBackfillDate(i) {
  activeBackfillIndex = i;
  const h = calc().holdings[i];
  document.getElementById('dateTitle').textContent = `Backfill Date: ${h.ticker}`;
  document.getElementById('backfillDateInput').value = h.purchaseDate || today();
  document.getElementById('dateModal').classList.remove('hidden');
}

function closeDateModal() {
  activeBackfillIndex = null;
  document.getElementById('dateModal').classList.add('hidden');
}

function saveBackfillDate() {
  if (activeBackfillIndex === null) return;
  const h = calc().holdings[activeBackfillIndex];
  const date = document.getElementById('backfillDateInput').value || today();
  const buys = state.transactions
    .filter(t => t.ticker === h.ticker && t.type === 'BUY')
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (buys.length) {
    buys[0].date = date;
  } else {
    state.transactions.push({ date, type: 'BUY', ticker: h.ticker, shares: h.shares, price: h.costBasis, tier: h.tier, synthetic: true });
  }
  const idx = state.holdings.findIndex(x => x.ticker === h.ticker);
  if (idx >= 0) state.holdings[idx].purchaseDate = date;
  saveState();
  takeSnapshot('date backfilled');
  closeDateModal();
  render();
  showToast('Date saved');
}

function openModal() {
  editIndex = null;
  setEditMode(false);
  ['newTicker', 'newShares', 'newCostBasis'].forEach(id => { const x = document.getElementById(id); if (x) x.value = ''; });
  document.getElementById('newPurchaseDate').value = today();
  document.getElementById('newTier').value = 'SPEC';
  document.getElementById('addModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('addModal').classList.add('hidden');
  editIndex = null;
  setEditMode(false);
  ['newTicker', 'newShares', 'newCostBasis', 'newPurchaseDate'].forEach(id => { const x = document.getElementById(id); if (x) x.value = ''; });
}

function openEdit(i) {
  editIndex = i;
  const h = calc().holdings[i];
  document.getElementById('newTicker').value = h.ticker || '';
  document.getElementById('newShares').value = '';
  document.getElementById('newCostBasis').value = '';
  document.getElementById('newPurchaseDate').value = h.purchaseDate || today();
  document.getElementById('newTier').value = h.tier || 'SPEC';
  setEditMode(true);
  document.getElementById('addModal').classList.remove('hidden');
}

function saveEdit() {
  if (!isEditMode()) {
    addHolding();
    return;
  }
  const newTicker = (document.getElementById('newTicker')?.value || '').trim().toUpperCase();
  const tier = document.getElementById('newTier')?.value || 'SPEC';
  const date = document.getElementById('newPurchaseDate')?.value || today();
  if (!newTicker) {
    alert('Ticker cannot be empty.');
    return;
  }
  const h = calc().holdings[editIndex];
  const oldTicker = h.ticker;
  // Prevent renaming onto an existing different ticker.
  if (newTicker !== oldTicker && state.holdings.some(x => x.ticker === newTicker)) {
    alert(`Ticker ${newTicker} already exists. Use Add Tx on it instead.`);
    return;
  }
  const idx = state.holdings.findIndex(x => x.ticker === oldTicker);
  if (idx >= 0) state.holdings[idx] = { ...state.holdings[idx], ticker: newTicker, apiSymbol: newTicker, tier, purchaseDate: date };
  state.transactions.forEach(t => {
    if (t.ticker === oldTicker) {
      t.ticker = newTicker;
      t.tier = tier;
    }
  });
  const firstBuy = state.transactions
    .filter(t => t.ticker === newTicker && t.type === 'BUY')
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  if (firstBuy) firstBuy.date = date;
  if (oldTicker !== newTicker) {
    state.expanded[newTicker] = state.expanded[oldTicker];
    delete state.expanded[oldTicker];
  } else {
    state.expanded[newTicker] = true;
  }
  saveState();
  takeSnapshot('holding edited');
  closeModal();
  render();
  showToast('Holding updated');
}

function openTxModal(ticker) {
  ensureBaselineLot(ticker);
  saveState();
  activeTxTicker = ticker;
  const h = calc().holdings.find(x => x.ticker === ticker);
  document.getElementById('txTitle').textContent = `Add Transaction: ${ticker}`;
  document.getElementById('txType').value = 'BUY';
  document.getElementById('txDate').value = today();
  document.getElementById('txShares').value = '';
  document.getElementById('txPrice').value = h?.price || '';
  document.getElementById('txModal').classList.remove('hidden');
}

function closeTxModal() {
  activeTxTicker = null;
  document.getElementById('txModal').classList.add('hidden');
}

function saveTx() {
  const ticker = activeTxTicker;
  if (!ticker) return;
  ensureBaselineLot(ticker);
  const type = document.getElementById('txType').value;
  const date = document.getElementById('txDate').value || today();
  const shares = safeNum(document.getElementById('txShares').value);
  const price = safeNum(document.getElementById('txPrice').value);
  if (!['BUY', 'SELL'].includes(type) || shares <= 0 || price <= 0) {
    alert('Enter type, date, shares, and price.');
    return;
  }
  const h = calc().holdings.find(x => x.ticker === ticker);
  if (type === 'SELL' && h && shares > safeNum(h.shares)) {
    alert(`Cannot sell ${shares} shares. Current shares: ${h.shares.toFixed(4)}.`);
    return;
  }
  state.transactions.push({ date, type, ticker, shares, price, tier: h?.tier || 'SPEC' });
  state.expanded[ticker] = true;
  saveState();
  takeSnapshot(`${type} ${ticker}`);
  closeTxModal();
  render();
  showToast(`${type} saved`);
}

function applyField(el) {
  const key = el.dataset.key;
  if (!key) return;
  if (key === 'target') state.target = safeNum(el.value);
  else if (key === 'monthlySavings') state.monthlySavings = safeNum(el.value);
  else if (key.startsWith('capital:')) state.capital[key.split(':')[1]] = safeNum(el.value);
  else if (key.startsWith('rule:')) state.rules[key.split(':')[1]] = safeNum(el.value);
  saveState();
  render();
}

document.addEventListener('change', e => applyField(e.target));

document.addEventListener('click', e => {
  if (e.target.closest('[data-edit]')) {
    openEdit(Number(e.target.closest('[data-edit]').dataset.edit));
    return;
  }
  if (e.target.closest('[data-backfill]')) {
    openBackfillDate(Number(e.target.closest('[data-backfill]').dataset.backfill));
    return;
  }
  if (e.target.closest('[data-tx]')) {
    openTxModal(e.target.closest('[data-tx]').dataset.tx);
    return;
  }
  if (e.target.id === 'closeTxBtn') { closeTxModal(); return; }
  if (e.target.id === 'saveTxBtn') { saveTx(); return; }
  if (e.target.id === 'closeDateBtn') { closeDateModal(); return; }
  if (e.target.id === 'saveDateBtn') { saveBackfillDate(); return; }
  if (e.target.closest('[data-toggle]') && !e.target.closest('[data-remove]')) {
    const t = e.target.closest('[data-toggle]').dataset.toggle;
    state.expanded[t] = !state.expanded[t];
    saveState();
    render();
  }
  if (e.target.id === 'openAddHoldingBtn') openModal();
  if (e.target.id === 'closeModalBtn') closeModal();
  if (e.target.id === 'addHoldingBtn') saveEdit();
  if (e.target.id === 'refreshPricesBtn') refreshPrices();
  if (e.target.id === 'snapshotBtn') {
    takeSnapshot('manual');
    render();
    showToast('Snapshot saved');
  }
  if (e.target.id === 'clearHistoryBtn') {
    state.history = [];
    saveState();
    render();
    showToast('History cleared');
  }
  if (e.target.dataset.remove) {
    if (confirm('Remove this holding and its local price metadata? Transactions remain.')) {
      const h = calc().holdings[Number(e.target.dataset.remove)];
      state.holdings = state.holdings.filter(x => x.ticker !== h.ticker);
      saveState();
      takeSnapshot('holding removed');
      render();
      showToast('Holding removed');
    }
  }
  if (e.target.id === 'editTargetBtn') document.querySelector('[data-tab="inputs"]').click();
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tabPanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  };
});

document.getElementById('resetBtn').onclick = () => refreshPrices();
document.getElementById('exportBtn').onclick = () => {
  document.getElementById('backupBox').value = JSON.stringify(state, null, 2);
  showToast('Backup exported');
};

render();
