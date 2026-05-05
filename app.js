const DEFAULT_STATE = {
  apiKey: '',
  balances: {
    checking: 1287,
    hysa: 1200,
    bonds: 100,
    managedFund: 2400,
    brokerageRemainder: 2204,
    dipFund: 0
  },
  target: 50000,
  monthlySavings: 800,
  rules: {
    maxPortfolioLossPct: 0.15,
    marketBuyMoreDrawdown: 0.20,
    marketRiskOffDrawdown: 0.30,
    profitTrimPct: 0.40,
    stopLossPct: 0.30,
    trendReviewPct: 0.12,
    post40kRiskPct: 0.45,
    post45kRiskPct: 0.20,
    monthlyHysa: 700,
    monthlyBrokerage: 100
  },
  tiers: {
    CORE: { maxPosPct: 0.45, maxTierPct: 0.60, dip1: 0.20, dip2: 0.30, dip3: 0.40, buy: 250 },
    QUALITY: { maxPosPct: 0.10, maxTierPct: 0.20, dip1: 0.20, dip2: 0.30, dip3: 0.40, buy: 100 },
    THEME: { maxPosPct: 0.06, maxTierPct: 0.20, dip1: 0.30, dip2: 0.45, dip3: 0.60, buy: 75 },
    SPEC: { maxPosPct: 0.04, maxTierPct: 0.15, dip1: 0.50, dip2: 0.60, dip3: 0.70, buy: 50 }
  },
  holdings: [
    { ticker: 'RDDT', apiSymbol: 'RDDT', tier: 'THEME', shares: 6.29, costBasis: 168.6, price: 169.07, high52: 282.95, shortHigh: 169.07, lastUpdated: 'sheet import' },
    { ticker: 'BBAI', apiSymbol: 'BBAI', tier: 'SPEC', shares: 157, costBasis: 4.2, price: 4.17, high52: 9.39, shortHigh: 4.17, lastUpdated: 'sheet import' },
    { ticker: 'OKLO', apiSymbol: 'OKLO', tier: 'THEME', shares: 6.75, costBasis: 69.02, price: 68.6, high52: 193.84, shortHigh: 76.46, lastUpdated: 'sheet import' },
    { ticker: 'QBTS', apiSymbol: 'QBTS', tier: 'SPEC', shares: 15.81, costBasis: 20.86, price: 20.92, high52: 46.75, shortHigh: 21.69, lastUpdated: 'sheet import' },
    { ticker: 'DNN', apiSymbol: 'DNN', tier: 'THEME', shares: 51, costBasis: 3.74, price: 3.76, high52: 4.43, shortHigh: 4.08, lastUpdated: 'sheet import' },
    { ticker: 'SMR', apiSymbol: 'SMR', tier: 'THEME', shares: 15, costBasis: 12.21, price: 12.18, high52: 57.42, shortHigh: 13.57, lastUpdated: 'sheet import' },
    { ticker: 'GOOGL', apiSymbol: 'GOOGL', tier: 'QUALITY', shares: 0.4, costBasis: 382.86, price: 383.25, high52: 387.38, shortHigh: 385.69, lastUpdated: 'sheet import' },
    { ticker: 'SOUN', apiSymbol: 'SOUN', tier: 'SPEC', shares: 15.81, costBasis: 9.5, price: 9.47, high52: 22.17, shortHigh: 9.56, lastUpdated: 'sheet import' },
    { ticker: 'MU', apiSymbol: 'MU', tier: 'QUALITY', shares: 0.2, costBasis: 577.4, price: 576.45, high52: 592.8, shortHigh: 576.45, lastUpdated: 'sheet import' },
    { ticker: 'RGTI', apiSymbol: 'RGTI', tier: 'SPEC', shares: 5.18, costBasis: 17.75, price: 17.7, high52: 58.15, shortHigh: 19.81, lastUpdated: 'sheet import' }
  ],
  options: [
    { name: 'BBAI $3C 6/18/26', underlying: 'BBAI', contracts: 1, cost: 1.05, current: 0, multiplier: 100 },
    { name: 'BBAI $10C 1/15/27', underlying: 'BBAI', contracts: 11, cost: 0.35, current: 0, multiplier: 100 }
  ]
};

const clone = obj => JSON.parse(JSON.stringify(obj));
let state = loadState();

function mergeDefaults(defaults, saved) {
  const merged = clone(defaults);
  if (!saved || typeof saved !== 'object') return merged;
  if (saved.apiKey) merged.apiKey = saved.apiKey;
  merged.target = saved.target ?? merged.target;
  merged.monthlySavings = saved.monthlySavings ?? merged.monthlySavings;
  merged.rules = { ...merged.rules, ...(saved.rules || {}) };
  merged.tiers = { ...merged.tiers, ...(saved.tiers || {}) };
  merged.balances = { ...merged.balances, ...(saved.balances || {}) };
  if ('brokerageTotal' in merged.balances && !('brokerageRemainder' in (saved.balances || {}))) {
    const defaultKnownStocks = merged.holdings.reduce((sum, h) => sum + h.shares * h.price, 0);
    merged.balances.brokerageRemainder = Math.max(0, Number(merged.balances.brokerageTotal || 0) - defaultKnownStocks);
    delete merged.balances.brokerageTotal;
  }
  if (Array.isArray(saved.holdings) && saved.holdings.length) {
    merged.holdings = saved.holdings.map(h => ({
      ticker: h.ticker || '',
      apiSymbol: h.apiSymbol || h.ticker || '',
      tier: h.tier || 'SPEC',
      shares: safeNum(h.shares),
      costBasis: safeNum(h.costBasis),
      price: safeNum(h.price),
      high52: safeNum(h.high52),
      shortHigh: safeNum(h.shortHigh),
      lastUpdated: h.lastUpdated || ''
    }));
  }
  if (Array.isArray(saved.options)) merged.options = saved.options;
  return merged;
}

function loadState() {
  try {
    return mergeDefaults(DEFAULT_STATE, JSON.parse(localStorage.getItem('houseFundState') || '{}'));
  } catch {
    return clone(DEFAULT_STATE);
  }
}
function saveState() { localStorage.setItem('houseFundState', JSON.stringify(state)); }
const money = n => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = n => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct = n => `${(Number(n || 0) * 100).toFixed(0)}%`;
const pct1 = n => `${(Number(n || 0) * 100).toFixed(1)}%`;
function safeNum(n) { const x = Number(n); return Number.isFinite(x) ? x : 0; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function calc() {
  const cash = safeNum(state.balances.checking) + safeNum(state.balances.hysa);
  const stockValue = state.holdings.reduce((s,h)=>s + safeNum(h.shares) * safeNum(h.price),0);
  const optionsValue = state.options.reduce((s,o)=>s + safeNum(o.contracts) * safeNum(o.current) * safeNum(o.multiplier),0);
  const optionsCostRisk = state.options.reduce((s,o)=>s + safeNum(o.contracts) * safeNum(o.cost) * safeNum(o.multiplier),0);
  const total = cash + safeNum(state.balances.bonds) + safeNum(state.balances.managedFund) + safeNum(state.balances.brokerageRemainder) + safeNum(state.balances.dipFund) + stockValue + optionsValue;
  const riskAssets = safeNum(state.balances.managedFund) + safeNum(state.balances.brokerageRemainder) + stockValue + optionsValue;
  const riskPct = total ? riskAssets / total : 0;
  const lossBudget = total * safeNum(state.rules.maxPortfolioLossPct);
  const estimatedLossRisk = stockValue * 0.5 + optionsCostRisk;
  const marketDrawdownProxy = weightedMarketDrawdown();
  let regime = 'NORMAL';
  if (marketDrawdownProxy >= state.rules.marketRiskOffDrawdown) regime = 'RISK-OFF';
  else if (marketDrawdownProxy >= state.rules.marketBuyMoreDrawdown) regime = 'SELECTIVE BUYING';
  let glide = 'ACCUMULATE';
  if (total >= state.target) glide = 'FULL SAFE';
  else if (total >= 45000) glide = 'CAP RISK';
  else if (total >= 40000) glide = 'SLOW RISK';
  const enriched = state.holdings.map(h => enrichHolding(h,total,regime,estimatedLossRisk,lossBudget));
  return { cash, stockValue, optionsValue, optionsCostRisk, total, riskAssets, riskPct, lossBudget, estimatedLossRisk, regime, glide, holdings: enriched, marketDrawdownProxy };
}

function weightedMarketDrawdown() {
  const core = state.holdings.find(h => h.tier === 'CORE');
  if (core && core.high52) return Math.max(0, 1 - core.price / core.high52);
  const quality = state.holdings.filter(h => ['QUALITY','CORE'].includes(h.tier) && h.high52);
  if (!quality.length) return 0;
  return quality.reduce((s,h)=>s + Math.max(0,1-h.price/h.high52),0) / quality.length;
}

function enrichHolding(h,total,regime,estimatedLossRisk,lossBudget) {
  const tier = state.tiers[h.tier] || state.tiers.SPEC;
  const value = safeNum(h.shares) * safeNum(h.price);
  const posPct = total ? value/total : 0;
  const maxValue = total * safeNum(tier.maxPosPct);
  const draw52 = h.high52 ? Math.max(0,1 - h.price/h.high52) : 0;
  const shortDraw = h.shortHigh ? Math.max(0,1 - h.price/h.shortHigh) : 0;
  const profit = h.costBasis ? (h.price-h.costBasis)/h.costBasis : 0;
  const riskBlocked = regime === 'RISK-OFF' || estimatedLossRisk > lossBudget || value > maxValue;
  const buy = riskBlocked ? 0 : draw52 >= tier.dip3 ? tier.buy*3 : draw52 >= tier.dip2 ? tier.buy*2 : draw52 >= tier.dip1 ? tier.buy : 0;
  const sell = [];
  if (value > maxValue) sell.push(`TRIM TO CAP (${money(maxValue)})`);
  if (h.costBasis && profit <= -state.rules.stopLossPct) sell.push('STOP-LOSS REVIEW');
  if (h.costBasis && profit >= state.rules.profitTrimPct) sell.push('PROFIT TRIM');
  if (shortDraw >= state.rules.trendReviewPct) sell.push('TREND REVIEW');
  const action = sell[0] || (buy>0 ? `BUY ${money(buy)}` : 'HOLD');
  return { ...h, value, posPct, maxValue, draw52, shortDraw, profit, buy, sell, action };
}

async function fetchTwelveDataDaily(symbol, apiKey) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=370&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'error') throw new Error(data.message || 'Twelve Data returned an error');
  if (!Array.isArray(data.values) || !data.values.length) throw new Error('No daily price data returned');
  const values = data.values
    .filter(v => Number.isFinite(Number(v.close)))
    .sort((a,b) => new Date(b.datetime) - new Date(a.datetime));
  if (!values.length) throw new Error('No usable close prices returned');
  const latest = values[0];
  const highs = values.map(v => safeNum(v.high || v.close)).filter(Boolean);
  const shortHighs = values.slice(0, 20).map(v => safeNum(v.high || v.close)).filter(Boolean);
  return {
    price: safeNum(latest.close),
    high52: highs.length ? Math.max(...highs) : safeNum(latest.close),
    shortHigh: shortHighs.length ? Math.max(...shortHighs) : safeNum(latest.close),
    lastUpdated: latest.datetime
  };
}

async function refreshPrices() {
  const keyInput = document.getElementById('apiKeyInput');
  const status = document.getElementById('apiStatus');
  const btn = document.getElementById('refreshPricesBtn');
  const apiKey = (keyInput?.value || state.apiKey || '').trim();
  if (!apiKey) {
    if (status) status.textContent = 'Paste your Twelve Data API key first.';
    return;
  }
  state.apiKey = apiKey;
  saveState();
  if (btn) btn.disabled = true;
  const errors = [];
  for (let i = 0; i < state.holdings.length; i++) {
    const h = state.holdings[i];
    const symbol = (h.apiSymbol || h.ticker || '').trim();
    if (!symbol) continue;
    if (status) status.textContent = `Refreshing ${h.ticker} (${i+1}/${state.holdings.length})…`;
    try {
      const quote = await fetchTwelveDataDaily(symbol, apiKey);
      state.holdings[i] = { ...h, ...quote, apiSymbol: symbol };
      saveState();
    } catch (err) {
      errors.push(`${h.ticker}: ${err.message}`);
    }
    await sleep(850);
  }
  if (status) status.textContent = errors.length ? `Refresh finished with issues: ${errors.join(' | ')}` : `Refresh complete: ${new Date().toLocaleString()}`;
  if (btn) btn.disabled = false;
  render();
}

function render() {
  const c = calc();
  document.getElementById('totalFund').textContent = money(c.total);
  document.getElementById('progressBar').style.width = `${Math.min(100,c.total/state.target*100)}%`;
  document.getElementById('progressText').textContent = `${pct(c.total/state.target)} to $${state.target.toLocaleString()}`;
  const months = state.monthlySavings > 0 ? Math.max(0, Math.ceil((state.target-c.total)/state.monthlySavings)) : 0;
  const d = new Date(); d.setMonth(d.getMonth()+months);
  document.getElementById('targetDate').textContent = `${months} months to target · approx ${d.toLocaleDateString()}`;
  document.getElementById('marketRegime').textContent = c.regime;
  document.getElementById('marketRegimeNote').textContent = `${c.glide} · proxy market drawdown ${pct1(c.marketDrawdownProxy)}`;
  document.getElementById('riskPct').textContent = pct(c.riskPct);
  document.getElementById('riskNote').textContent = `Risk assets ${money(c.riskAssets)}`;
  document.getElementById('lossBudget').textContent = money(c.lossBudget);
  document.getElementById('lossBudgetNote').textContent = `Estimated loss at risk ${money(c.estimatedLossRisk)}`;
  document.getElementById('monthlyRouting').textContent = c.regime==='RISK-OFF' ? '$800 HYSA' : c.glide==='FULL SAFE' ? '$800 HYSA/Bonds' : '$700 HYSA | $100 Brokerage';
  renderHoldings(c.holdings);
  renderSignals(c.holdings,c);
  renderInputs();
  renderRules();
}

function renderHoldings(holdings) {
  document.getElementById('holdingsList').innerHTML = holdings.map((h,i)=>`<article class="card holdingCard"><div class="holdingTop"><h3>${h.ticker} <span class="pill">${h.tier}</span></h3><button class="ghost small" data-remove="${i}">Remove</button></div><p>${h.shares} shares · ${money2(h.price)} price · ${money(h.value)} · ${pct1(h.posPct)} of fund</p><p>52W high ${money2(h.high52)} · 52W dip ${pct1(h.draw52)} · 20D dip ${pct1(h.shortDraw)} · P/L ${pct1(h.profit)}</p><p class="muted">Updated: ${h.lastUpdated || 'manual'}</p><p><strong>${h.action}</strong></p></article>`).join('');
}
function alertHtml(items, empty='None') { return items.length ? items.map(x=>`<div class="alert">${x}</div>`).join('') : `<p class="muted">${empty}</p>`; }
function renderSignals(holdings,c) {
  const buys = holdings.filter(h=>h.buy>0).map(h=>`${h.ticker}: ${money(h.buy)} buy signal (${pct1(h.draw52)} 52W dip)`);
  const sells = holdings.filter(h=>h.sell.length).map(h=>`${h.ticker}: ${h.sell.join(' + ')}`);
  const top = [];
  if (c.estimatedLossRisk > c.lossBudget) top.push('Loss budget exceeded: pause new risk.');
  if (c.riskPct > 0.65) top.push('Risk assets are very high relative to total house fund.');
  top.push(...sells.slice(0,3), ...buys.slice(0,3));
  document.getElementById('buySignals').innerHTML = alertHtml(buys);
  document.getElementById('sellSignals').innerHTML = alertHtml(sells);
  document.getElementById('topAlerts').innerHTML = alertHtml(top);
}
function input(label,value,key,type='number',step='any') { return `<label>${label}<input type="${type}" step="${step}" value="${value ?? ''}" data-key="${key}"></label>`; }
function renderInputs() {
  const b = state.balances;
  document.getElementById('balanceInputs').innerHTML = Object.entries(b).map(([k,v])=>input(k,v,`balance:${k}`)).join('');
  document.getElementById('priceInputs').innerHTML = `
    <div class="apiBox">
      <label>Twelve Data API Key<input id="apiKeyInput" type="password" value="${state.apiKey || ''}" autocomplete="off"></label>
      <button id="refreshPricesBtn" class="primary" type="button">Refresh Prices + 52W Highs</button>
      <p id="apiStatus" class="muted">Only ticker, shares, cost basis, and tier are needed. Prices and highs update from Twelve Data.</p>
    </div>
    <div class="addHoldingBox">
      <h3>Add Holding</h3>
      <label>Ticker<input id="newTicker" placeholder="e.g., VOO"></label>
      <label>Shares<input id="newShares" type="number" step="any" placeholder="0"></label>
      <label>Cost Basis / Share<input id="newCostBasis" type="number" step="any" placeholder="0"></label>
      <label>Tier<select id="newTier"><option>CORE</option><option>QUALITY</option><option>THEME</option><option selected>SPEC</option></select></label>
      <button id="addHoldingBtn" class="primary" type="button">Add Holding</button>
    </div>
    <div class="holdingEditGrid">
      ${state.holdings.map((h,i)=>`
        <div class="miniCard">
          <strong>${h.ticker}</strong>
          ${input('Ticker',h.ticker,`holding:${i}:ticker`,'text')}
          ${input('API Symbol',h.apiSymbol || h.ticker,`holding:${i}:apiSymbol`,'text')}
          ${input('Shares',h.shares,`holding:${i}:shares`)}
          ${input('Cost Basis',h.costBasis,`holding:${i}:costBasis`)}
          <label>Tier<select data-key="holding:${i}:tier">${Object.keys(state.tiers).map(t=>`<option ${h.tier===t?'selected':''}>${t}</option>`).join('')}</select></label>
        </div>`).join('')}
    </div>`;
}
function renderRules() {
  document.getElementById('ruleInputs').innerHTML = Object.entries(state.rules).map(([k,v])=>input(k,v,`rule:${k}`)).join('');
}

function addHolding() {
  const ticker = (document.getElementById('newTicker')?.value || '').trim().toUpperCase();
  const shares = safeNum(document.getElementById('newShares')?.value);
  const costBasis = safeNum(document.getElementById('newCostBasis')?.value);
  const tier = document.getElementById('newTier')?.value || 'SPEC';
  if (!ticker || shares <= 0) {
    const status = document.getElementById('apiStatus');
    if (status) status.textContent = 'Add a ticker and share count first.';
    return;
  }
  state.holdings.push({ ticker, apiSymbol: ticker, tier, shares, costBasis, price: 0, high52: 0, shortHigh: 0, lastUpdated: 'new holding - refresh prices' });
  saveState(); render();
}

function removeHolding(index) {
  state.holdings.splice(index,1);
  saveState(); render();
}

document.addEventListener('input', e => {
  const key = e.target.dataset.key; if(!key) return;
  const parts = key.split(':');
  if(parts[0]==='balance') state.balances[parts[1]]=safeNum(e.target.value);
  if(parts[0]==='rule') state.rules[parts[1]]=safeNum(e.target.value);
  if(parts[0]==='holding') {
    const i = Number(parts[1]); const prop = parts[2];
    if (!state.holdings[i]) return;
    if (['ticker','apiSymbol','tier'].includes(prop)) state.holdings[i][prop] = String(e.target.value).trim().toUpperCase();
    else state.holdings[i][prop] = safeNum(e.target.value);
  }
  saveState();
  if (parts[0] !== 'holding' || !['ticker','apiSymbol','tier'].includes(parts[2])) render();
});

document.addEventListener('click', e => {
  if (e.target.id === 'refreshPricesBtn') refreshPrices();
  if (e.target.id === 'addHoldingBtn') addHolding();
  if (e.target.dataset.remove) removeHolding(Number(e.target.dataset.remove));
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tabPanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  };
});

document.getElementById('resetBtn').onclick = () => { localStorage.removeItem('houseFundState'); state=clone(DEFAULT_STATE); render(); };
document.getElementById('exportBtn').onclick = () => { document.getElementById('backupBox').value = JSON.stringify(state,null,2); };
render();
