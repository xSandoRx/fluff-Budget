const DEFAULT_STATE = {
  setupComplete: false,
  balances: { checking: 0, hysa: 0, bonds: 0, brokerageTotal: 0, managedFund: 0, dipFund: 0 },
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
  holdings: [],
  options: []
};

let state = loadState();

function cloneDefault(){ return JSON.parse(JSON.stringify(DEFAULT_STATE)); }
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('houseFundState') || 'null');
    return saved ? mergeState(cloneDefault(), saved) : cloneDefault();
  } catch { return cloneDefault(); }
}
function mergeState(base, saved){
  return {
    ...base,
    ...saved,
    balances: { ...base.balances, ...(saved.balances || {}) },
    rules: { ...base.rules, ...(saved.rules || {}) },
    tiers: { ...base.tiers, ...(saved.tiers || {}) },
    holdings: Array.isArray(saved.holdings) ? saved.holdings : [],
    options: Array.isArray(saved.options) ? saved.options : []
  };
}
function saveState() { localStorage.setItem('houseFundState', JSON.stringify(state)); }
const money = n => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = n => `${(Number(n || 0) * 100).toFixed(0)}%`;
const safeNum = n => Number.isFinite(Number(n)) ? Number(n) : 0;

function calc() {
  const cash = safeNum(state.balances.checking) + safeNum(state.balances.hysa);
  const stockValue = state.holdings.reduce((s,h)=>s+safeNum(h.shares)*safeNum(h.price),0);
  const optionsCostRisk = state.options.reduce((s,o)=>s+safeNum(o.contracts)*safeNum(o.cost)*safeNum(o.multiplier || 100),0);
  const total = cash + safeNum(state.balances.bonds) + safeNum(state.balances.brokerageTotal) + safeNum(state.balances.managedFund);
  const riskAssets = safeNum(state.balances.brokerageTotal) + safeNum(state.balances.managedFund);
  const riskPct = total ? riskAssets / total : 0;
  const lossBudget = total * safeNum(state.rules.maxPortfolioLossPct);
  const estimatedLossRisk = stockValue * 0.5 + optionsCostRisk;
  const marketDrawdown = getMarketProxyDrawdown();
  let regime = 'NORMAL';
  if (marketDrawdown >= state.rules.marketRiskOffDrawdown) regime = 'RISK-OFF';
  else if (marketDrawdown >= state.rules.marketBuyMoreDrawdown) regime = 'SELECTIVE BUYING';
  let glide = 'ACCUMULATE';
  if (total >= state.target) glide = 'FULL SAFE';
  else if (total >= 45000) glide = 'CAP RISK';
  else if (total >= 40000) glide = 'SLOW RISK';
  const enriched = state.holdings.map(h => enrichHolding(h,total,regime,estimatedLossRisk,lossBudget));
  return { cash, stockValue, optionsCostRisk, total, riskAssets, riskPct, lossBudget, estimatedLossRisk, regime, glide, marketDrawdown, holdings: enriched };
}

function getMarketProxyDrawdown(){
  const core = state.holdings.find(h => String(h.ticker || '').toUpperCase()==='VOO' || h.tier==='CORE');
  if (!core || !safeNum(core.high52)) return 0;
  return Math.max(0, 1 - safeNum(core.price)/safeNum(core.high52));
}
function enrichHolding(h,total,regime,estimatedLossRisk,lossBudget) {
  const tier = state.tiers[h.tier] || state.tiers.SPEC;
  const value = safeNum(h.shares)*safeNum(h.price);
  const posPct = total ? value/total : 0;
  const maxValue = total * tier.maxPosPct;
  const draw52 = h.high52 ? Math.max(0,1-safeNum(h.price)/safeNum(h.high52)) : 0;
  const shortDraw = h.shortHigh ? Math.max(0,1-safeNum(h.price)/safeNum(h.shortHigh)) : 0;
  const profit = h.costBasis ? (safeNum(h.price)-safeNum(h.costBasis))/safeNum(h.costBasis) : 0;
  const buyBlocked = regime==='RISK-OFF' || estimatedLossRisk>lossBudget || value>maxValue;
  const buy = buyBlocked ? 0 : draw52>=tier.dip3 ? tier.buy*3 : draw52>=tier.dip2 ? tier.buy*2 : draw52>=tier.dip1 ? tier.buy : 0;
  const sell = [];
  if (value > maxValue && maxValue > 0) sell.push(`TRIM TO CAP (${money(maxValue)})`);
  if (h.costBasis && profit <= -state.rules.stopLossPct) sell.push('STOP-LOSS REVIEW');
  if (h.costBasis && profit >= state.rules.profitTrimPct) sell.push('PROFIT TRIM');
  if (shortDraw >= state.rules.trendReviewPct) sell.push('TREND REVIEW');
  const action = sell[0] || (buy>0 ? `BUY ${money(buy)}` : 'HOLD');
  return { ...h, value, posPct, maxValue, draw52, shortDraw, profit, buy, sell, action };
}

function render() {
  const c = calc();
  document.getElementById('totalFund').textContent = money(c.total);
  document.getElementById('progressBar').style.width = `${Math.min(100,c.total/state.target*100)}%`;
  document.getElementById('progressText').textContent = `${pct(c.total/state.target)} to ${money(state.target)}`;
  const months = state.monthlySavings > 0 ? Math.max(0, Math.ceil((state.target-c.total)/state.monthlySavings)) : 0;
  const d = new Date(); d.setMonth(d.getMonth()+months);
  document.getElementById('targetDate').textContent = c.total ? `${months} months to target · approx ${d.toLocaleDateString()}` : 'Add your balances to begin';
  document.getElementById('marketRegime').textContent = c.regime;
  document.getElementById('marketRegimeNote').textContent = `${c.glide} · market proxy dip ${pct(c.marketDrawdown)}`;
  document.getElementById('riskPct').textContent = pct(c.riskPct);
  document.getElementById('riskNote').textContent = `Risk assets ${money(c.riskAssets)}`;
  document.getElementById('lossBudget').textContent = money(c.lossBudget);
  document.getElementById('lossBudgetNote').textContent = `Estimated loss at risk ${money(c.estimatedLossRisk)}`;
  document.getElementById('monthlyRouting').textContent = c.regime==='RISK-OFF' ? `${money(state.monthlySavings)} HYSA` : c.glide==='FULL SAFE' ? `${money(state.monthlySavings)} HYSA/Bonds` : `${money(state.rules.monthlyHysa)} HYSA | ${money(state.rules.monthlyBrokerage)} Brokerage`;
  renderHoldings(c.holdings);
  renderSignals(c.holdings,c);
  renderInputs();
  renderRules();
}

function renderHoldings(holdings) {
  const html = holdings.length ? holdings.map((h,i)=>`<article class="card"><h3>${h.ticker} <span class="pill">${h.tier}</span></h3><p>${h.shares} shares · ${money(h.value)} · ${pct(h.posPct)} of fund</p><p>52W dip ${pct(h.draw52)} · short dip ${pct(h.shortDraw)} · P/L ${h.costBasis ? pct(h.profit) : 'cost basis needed'}</p><p><strong>${h.action}</strong></p><button class="ghost small" data-remove="${i}">Remove</button></article>`).join('') : '<article class="card"><p>No holdings yet. Add positions under Inputs.</p></article>';
  document.getElementById('holdingsList').innerHTML = html;
}
function alertHtml(items, empty='None') { return items.length ? items.map(x=>`<div class="alert">${x}</div>`).join('') : `<p class="muted">${empty}</p>`; }
function renderSignals(holdings,c) {
  const buys = holdings.filter(h=>h.buy>0).map(h=>`${h.ticker}: ${money(h.buy)} buy signal (${pct(h.draw52)} 52W dip)`);
  const sells = holdings.filter(h=>h.sell.length).map(h=>`${h.ticker}: ${h.sell.join(' + ')}`);
  const top = [];
  if (!state.setupComplete) top.push('Private-safe mode: no personal portfolio data is stored in GitHub. Add your data locally.');
  if (c.estimatedLossRisk > c.lossBudget && c.total > 0) top.push('Loss budget exceeded: pause new risk.');
  if (c.riskPct > 0.65) top.push('Risk assets are very high relative to total house fund.');
  top.push(...sells.slice(0,3), ...buys.slice(0,3));
  document.getElementById('buySignals').innerHTML = alertHtml(buys);
  document.getElementById('sellSignals').innerHTML = alertHtml(sells);
  document.getElementById('topAlerts').innerHTML = alertHtml(top);
}
function input(label,value,key,type='number') { return `<label>${label}<input type="${type}" value="${value ?? ''}" data-key="${key}"></label>`; }
function renderInputs() {
  const b = state.balances;
  const balanceHtml = Object.entries(b).map(([k,v])=>input(k,v,`balance:${k}`)).join('') + input('Target',state.target,'target') + input('Monthly savings',state.monthlySavings,'monthlySavings');
  document.getElementById('balanceInputs').innerHTML = balanceHtml;
  const addForm = `<div class="addBox"><h3>Add Position</h3>${input('Ticker','','new:ticker','text')}${input('Tier (CORE/QUALITY/THEME/SPEC)','SPEC','new:tier','text')}${input('Shares','','new:shares')}${input('Cost basis / share','','new:costBasis')}${input('Current price','','new:price')}${input('52W high','','new:high52')}${input('Short-term high','','new:shortHigh')}<button id="addHoldingBtn" class="primary">Add Position</button></div>`;
  const priceHtml = state.holdings.map((h,i)=>input(`${h.ticker} price`,h.price,`price:${i}`)).join('');
  document.getElementById('priceInputs').innerHTML = addForm + priceHtml;
}
function renderRules() {
  document.getElementById('ruleInputs').innerHTML = Object.entries(state.rules).map(([k,v])=>input(k,v,`rule:${k}`)).join('');
}
function collectNewHolding(){
  const get = k => document.querySelector(`[data-key="new:${k}"]`)?.value || '';
  const ticker = get('ticker').trim().toUpperCase();
  if(!ticker) return null;
  return { ticker, tier: (get('tier')||'SPEC').trim().toUpperCase(), shares: safeNum(get('shares')), costBasis: safeNum(get('costBasis')), price: safeNum(get('price')), high52: safeNum(get('high52')), shortHigh: safeNum(get('shortHigh')) };
}

document.addEventListener('input', e => {
  const key = e.target.dataset.key; if(!key || key.startsWith('new:')) return;
  const [type,id] = key.split(':'); const val = safeNum(e.target.value);
  if(type==='balance') state.balances[id]=val;
  if(type==='price') state.holdings[Number(id)].price=val;
  if(type==='rule') state.rules[id]=val;
  if(type==='target') state.target=val;
  if(type==='monthlySavings') state.monthlySavings=val;
  state.setupComplete = true;
  saveState(); render();
});
document.addEventListener('click', e => {
  if(e.target.id==='addHoldingBtn'){
    const h = collectNewHolding();
    if(h){ state.holdings.push(h); state.setupComplete=true; saveState(); render(); }
  }
  if(e.target.dataset.remove){ state.holdings.splice(Number(e.target.dataset.remove),1); saveState(); render(); }
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tabPanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  }
});
document.getElementById('resetBtn').onclick = () => { localStorage.removeItem('houseFundState'); state=cloneDefault(); render(); };
document.getElementById('exportBtn').onclick = () => { document.getElementById('backupBox').value = JSON.stringify(state,null,2); };
render();
