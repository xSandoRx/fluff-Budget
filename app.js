const DEFAULT_STATE = {
  balances: { checking: 1287, hysa: 1200, bonds: 100, brokerageTotal: 5600, managedFund: 2400, dipFund: 0 },
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
    { ticker: 'RDDT', tier: 'THEME', shares: 6.29, costBasis: 168.6, price: 169.07, high52: 282.95, shortHigh: 169.07 },
    { ticker: 'BBAI', tier: 'SPEC', shares: 157, costBasis: 4.2, price: 4.17, high52: 9.39, shortHigh: 4.17 },
    { ticker: 'OKLO', tier: 'THEME', shares: 6.75, costBasis: 69.02, price: 68.6, high52: 193.84, shortHigh: 76.46 },
    { ticker: 'QBTS', tier: 'SPEC', shares: 15.81, costBasis: 20.86, price: 20.92, high52: 46.75, shortHigh: 21.69 },
    { ticker: 'DNN', tier: 'THEME', shares: 51, costBasis: 3.74, price: 3.76, high52: 4.43, shortHigh: 4.08 },
    { ticker: 'SMR', tier: 'THEME', shares: 15, costBasis: 12.21, price: 12.18, high52: 57.42, shortHigh: 13.57 },
    { ticker: 'GOOGL', tier: 'QUALITY', shares: 0.4, costBasis: 382.86, price: 383.25, high52: 387.38, shortHigh: 385.69 },
    { ticker: 'SOUN', tier: 'SPEC', shares: 15.81, costBasis: 9.5, price: 9.47, high52: 22.17, shortHigh: 9.56 },
    { ticker: 'MU', tier: 'QUALITY', shares: 0.2, costBasis: 577.4, price: 576.45, high52: 592.8, shortHigh: 576.45 },
    { ticker: 'RGTI', tier: 'SPEC', shares: 5.18, costBasis: 17.75, price: 17.7, high52: 58.15, shortHigh: 19.81 }
  ],
  options: [
    { name: 'BBAI $3C 6/18/26', underlying: 'BBAI', contracts: 1, cost: 1.05, current: 0, multiplier: 100 },
    { name: 'BBAI $10C 1/15/27', underlying: 'BBAI', contracts: 11, cost: 0.35, current: 0, multiplier: 100 }
  ]
};

let state = loadState();

function loadState() {
  try { return { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem('houseFundState') || '{}') }; }
  catch { return structuredClone(DEFAULT_STATE); }
}
function saveState() { localStorage.setItem('houseFundState', JSON.stringify(state)); }
const money = n => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = n => `${(Number(n || 0) * 100).toFixed(0)}%`;
const safeNum = n => Number.isFinite(Number(n)) ? Number(n) : 0;

function calc() {
  const cash = state.balances.checking + state.balances.hysa;
  const stockValue = state.holdings.reduce((s,h)=>s+h.shares*h.price,0);
  const optionsValue = state.options.reduce((s,o)=>s+o.contracts*o.current*o.multiplier,0);
  const optionsCostRisk = state.options.reduce((s,o)=>s+o.contracts*o.cost*o.multiplier,0);
  const total = cash + state.balances.bonds + state.balances.brokerageTotal + state.balances.managedFund;
  const riskAssets = state.balances.brokerageTotal + state.balances.managedFund;
  const riskPct = total ? riskAssets / total : 0;
  const lossBudget = total * state.rules.maxPortfolioLossPct;
  const estimatedLossRisk = stockValue * 0.5 + optionsCostRisk;
  const vooDrawdown = 0.01;
  let regime = 'NORMAL';
  if (vooDrawdown >= state.rules.marketRiskOffDrawdown) regime = 'RISK-OFF';
  else if (vooDrawdown >= state.rules.marketBuyMoreDrawdown) regime = 'SELECTIVE BUYING';
  let glide = 'ACCUMULATE';
  if (total >= 50000) glide = 'FULL SAFE';
  else if (total >= 45000) glide = 'CAP RISK';
  else if (total >= 40000) glide = 'SLOW RISK';
  const enriched = state.holdings.map(h => enrichHolding(h,total,regime,estimatedLossRisk,lossBudget));
  return { cash, stockValue, optionsValue, optionsCostRisk, total, riskAssets, riskPct, lossBudget, estimatedLossRisk, regime, glide, holdings: enriched };
}

function enrichHolding(h,total,regime,estimatedLossRisk,lossBudget) {
  const tier = state.tiers[h.tier];
  const value = h.shares*h.price;
  const posPct = total ? value/total : 0;
  const maxValue = total * tier.maxPosPct;
  const draw52 = h.high52 ? Math.max(0,1-h.price/h.high52) : 0;
  const shortDraw = h.shortHigh ? Math.max(0,1-h.price/h.shortHigh) : 0;
  const profit = h.costBasis ? (h.price-h.costBasis)/h.costBasis : 0;
  const buy = (regime==='RISK-OFF' || estimatedLossRisk>lossBudget || value>maxValue) ? 0 : draw52>=tier.dip3 ? tier.buy*3 : draw52>=tier.dip2 ? tier.buy*2 : draw52>=tier.dip1 ? tier.buy : 0;
  const sell = [];
  if (value > maxValue) sell.push(`TRIM TO CAP (${money(maxValue)})`);
  if (profit <= -state.rules.stopLossPct) sell.push('STOP-LOSS REVIEW');
  if (profit >= state.rules.profitTrimPct) sell.push('PROFIT TRIM');
  if (shortDraw >= state.rules.trendReviewPct) sell.push('TREND REVIEW');
  let action = sell[0] || (buy>0 ? `BUY ${money(buy)}` : 'HOLD');
  return { ...h, value, posPct, maxValue, draw52, shortDraw, profit, buy, sell, action };
}

function render() {
  const c = calc();
  document.getElementById('totalFund').textContent = money(c.total);
  document.getElementById('progressBar').style.width = `${Math.min(100,c.total/state.target*100)}%`;
  document.getElementById('progressText').textContent = `${pct(c.total/state.target)} to $50k`;
  const months = Math.max(0, Math.ceil((state.target-c.total)/state.monthlySavings));
  const d = new Date(); d.setMonth(d.getMonth()+months);
  document.getElementById('targetDate').textContent = `${months} months to target · approx ${d.toLocaleDateString()}`;
  document.getElementById('marketRegime').textContent = c.regime;
  document.getElementById('marketRegimeNote').textContent = c.glide;
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
  document.getElementById('holdingsList').innerHTML = holdings.map(h=>`<article class="card"><h3>${h.ticker} <span class="pill">${h.tier}</span></h3><p>${h.shares} shares · ${money(h.value)} · ${pct(h.posPct)} of fund</p><p>52W dip ${pct(h.draw52)} · short dip ${pct(h.shortDraw)} · P/L ${pct(h.profit)}</p><p><strong>${h.action}</strong></p></article>`).join('');
}
function alertHtml(items, empty='None') { return items.length ? items.map(x=>`<div class="alert">${x}</div>`).join('') : `<p class="muted">${empty}</p>`; }
function renderSignals(holdings,c) {
  const buys = holdings.filter(h=>h.buy>0).map(h=>`${h.ticker}: ${money(h.buy)} buy signal (${pct(h.draw52)} 52W dip)`);
  const sells = holdings.filter(h=>h.sell.length).map(h=>`${h.ticker}: ${h.sell.join(' + ')}`);
  const top = [];
  if (c.estimatedLossRisk > c.lossBudget) top.push('Loss budget exceeded: pause new risk.');
  if (c.riskPct > 0.65) top.push('Risk assets are very high relative to total house fund.');
  top.push(...sells.slice(0,3), ...buys.slice(0,3));
  document.getElementById('buySignals').innerHTML = alertHtml(buys);
  document.getElementById('sellSignals').innerHTML = alertHtml(sells);
  document.getElementById('topAlerts').innerHTML = alertHtml(top);
}
function input(label,value,onchange,type='number') { return `<label>${label}<input type="${type}" value="${value}" data-key="${onchange}"></label>`; }
function renderInputs() {
  const b = state.balances;
  document.getElementById('balanceInputs').innerHTML = Object.entries(b).map(([k,v])=>input(k,v,`balance:${k}`)).join('');
  document.getElementById('priceInputs').innerHTML = state.holdings.map((h,i)=>input(`${h.ticker} price`,h.price,`price:${i}`)).join('');
}
function renderRules() {
  document.getElementById('ruleInputs').innerHTML = Object.entries(state.rules).map(([k,v])=>input(k,v,`rule:${k}`)).join('');
}

document.addEventListener('input', e => {
  const key = e.target.dataset.key; if(!key) return;
  const [type,id] = key.split(':'); const val = safeNum(e.target.value);
  if(type==='balance') state.balances[id]=val;
  if(type==='price') state.holdings[Number(id)].price=val;
  if(type==='rule') state.rules[id]=val;
  saveState(); render();
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tabPanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  }
});

document.getElementById('resetBtn').onclick = () => { localStorage.removeItem('houseFundState'); state=structuredClone(DEFAULT_STATE); render(); };
document.getElementById('exportBtn').onclick = () => { document.getElementById('backupBox').value = JSON.stringify(state,null,2); };
render();
