import { initDB, getPortfolio, updatePortfolio, addJournalEntry, getJournalEntries, addWatchlistDB, getWatchlistDB, removeWatchlistDB, exportAllData, importAllData, updateJournalEntry, deleteJournalEntry } from './db.js';
import { calculateRisk, checkSEPA } from './rules.js';

document.addEventListener('DOMContentLoaded', async () => {

  // Toast System
  window.showToast = function(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if(!container) return;
    
    const toast = document.createElement('div');
    toast.className = `px-4 py-3 rounded-xl shadow-lg transform transition-all duration-300 translate-y-[-100%] opacity-0 flex items-center gap-2 max-w-sm w-max`;
    
    let bgColor = 'bg-gray-800 text-white border-gray-700';
    let icon = 'ℹ️';
    
    if(type === 'success') {
      bgColor = 'bg-green-100 text-green-800 border-green-200';
      icon = '✅';
    } else if (type === 'error') {
      bgColor = 'bg-red-100 text-red-800 border-red-200';
      icon = '❌';
    } else if (type === 'warning') {
      bgColor = 'bg-yellow-100 text-yellow-800 border-yellow-200';
      icon = '⚠️';
    }
    
    toast.classList.add(...bgColor.split(' '), 'border');
    toast.innerHTML = `<span>${icon}</span><span class="text-sm font-bold">${message}</span>`;
    
    container.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
      toast.classList.remove('translate-y-[-100%]', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    }, 10);
    
    // Animate out
    setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-[-100%]', 'opacity-0');
      setTimeout(() => {
        if(toast.parentElement) toast.remove();
      }, 300);
    }, 3000);
  };

  let currentTraderPortfolio = null;
  let currentVIPortfolio = null;
  let currentCapitalEditingType = 'trader';
  let currentDashboardTimeframe = 'all';

  try {
    await initDB();
    console.log("IndexedDB initialized");
  } catch (e) {
    console.error("DB Init error:", e);
  }

  // Bind inputs for Risk Calculator
  const accountSizeInput = document.getElementById('calc-account-size');
  const riskPctInput = document.getElementById('calc-risk-pct');
  const entryPriceInput = document.getElementById('calc-entry-price');
  const stopLossInput = document.getElementById('calc-stop-loss');
  const targetPriceInput = document.getElementById('calc-target-price');
  const fracToggle = document.getElementById('calc-frac');
  
  const riskPctDisplay = document.getElementById('display-risk-pct');
  
  const outShares = document.getElementById('out-shares');
  const outPosVal = document.getElementById('out-pos-val');
  const outRiskAmt = document.getElementById('out-risk-amt');
  const outPosPct = document.getElementById('out-pos-pct');
  const outRewardAmt = document.getElementById('out-reward-amt');
  const outRR = document.getElementById('out-rr');

  function updateRiskCalc() {
    if(!accountSizeInput) return; // not hooked up in HTML yet
    const accountSize = parseFloat(accountSizeInput.value) || 0;
    const riskPct = parseFloat(riskPctInput.value) || 0;
    const entryPrice = parseFloat(entryPriceInput.value) || 0;
    const stopPrice = parseFloat(stopLossInput.value) || 0;
    const targetPrice = targetPriceInput ? (parseFloat(targetPriceInput.value) || 0) : 0;
    const fractional = fracToggle ? fracToggle.checked : false;

    riskPctDisplay.innerText = riskPct.toFixed(1) + '%';

    if(entryPrice > 0 && stopPrice > 0 && entryPrice > stopPrice && accountSize > 0) {
      const res = calculateRisk(accountSize, riskPct, entryPrice, stopPrice, targetPrice, fractional);
      if(res.errors && res.errors.length > 0) {
        outShares.innerText = "0";
        outPosVal.innerText = "-";
        outRiskAmt.innerText = "-";
        outPosPct.innerText = "-";
        if(outRewardAmt) outRewardAmt.innerText = "-";
        if(outRR) outRR.innerText = "-";
      } else {
        outShares.innerText = res.shares.toLocaleString(undefined, {maximumFractionDigits: 4});
        outPosVal.innerText = "$" + res.positionValue.toLocaleString(undefined, {maximumFractionDigits: 2});
        outRiskAmt.innerText = "-$" + res.riskAmount.toLocaleString(undefined, {maximumFractionDigits: 2});
        outPosPct.innerText = res.positionPct.toFixed(1) + "%";
        
        if (outRewardAmt && outRR) {
          if (res.rewardAmount !== null && res.rrRatio !== null) {
            outRewardAmt.innerText = "+$" + res.rewardAmount.toLocaleString(undefined, {maximumFractionDigits: 2});
            outRR.innerText = "R/R: " + res.rrRatio.toFixed(1) + "x";
          } else {
            outRewardAmt.innerText = "-";
            outRR.innerText = "R/R: -";
          }
        }
      }
    } else {
      outShares.innerText = "0";
      outPosVal.innerText = "-";
      outRiskAmt.innerText = "-";
      outPosPct.innerText = "-";
      if(outRewardAmt) outRewardAmt.innerText = "-";
      if(outRR) outRR.innerText = "-";
    }
  }

  if(accountSizeInput) {
    [accountSizeInput, riskPctInput, entryPriceInput, stopLossInput, targetPriceInput, fracToggle].forEach(el => {
      if(el) el.addEventListener('input', updateRiskCalc);
    });
  }

  // Bind inputs for VI Position Sizing
  const viAllocPct = document.getElementById('vi-alloc-pct');
  const viAllocResult = document.getElementById('vi-alloc-result');
  const viMosFair = document.getElementById('vi-mos-fair');
  const viMosPrice = document.getElementById('vi-mos-price');
  const viMosPct = document.getElementById('vi-mos-pct');
  const viMosRecommend = document.getElementById('vi-mos-recommend');

  function updateVIRiskCalc() {
    if(!currentVIPortfolio) return;
    
    // Fixed Allocation
    const allocPct = parseFloat(viAllocPct?.value) || 0;
    const maxPos = currentVIPortfolio.capital * (allocPct / 100);
    if(viAllocResult) {
      viAllocResult.innerText = "$" + maxPos.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }

    // Margin of Safety
    const fair = parseFloat(viMosFair?.value) || 0;
    const price = parseFloat(viMosPrice?.value) || 0;
    
    if(fair > 0 && price > 0 && viMosPct && viMosRecommend) {
      const mos = ((fair - price) / fair) * 100;
      viMosPct.innerText = mos.toFixed(1) + "%";
      
      if(mos > 30) {
        viMosRecommend.innerText = "BUY LARGE (10% of Port)";
        viMosRecommend.className = "px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700";
        viMosPct.className = "text-3xl font-black text-green-600 mb-2";
      } else if(mos >= 10) {
        viMosRecommend.innerText = "BUY MEDIUM (5% of Port)";
        viMosRecommend.className = "px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700";
        viMosPct.className = "text-3xl font-black text-blue-600 mb-2";
      } else if (mos > 0) {
        viMosRecommend.innerText = "BUY SMALL (2% of Port)";
        viMosRecommend.className = "px-3 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700";
        viMosPct.className = "text-3xl font-black text-yellow-600 mb-2";
      } else {
        viMosRecommend.innerText = "TOO EXPENSIVE (Do Not Buy)";
        viMosRecommend.className = "px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700";
        viMosPct.className = "text-3xl font-black text-red-600 mb-2";
      }
    } else if(viMosPct && viMosRecommend) {
      viMosPct.innerText = "0.0%";
      viMosPct.className = "text-3xl font-black text-indigo-700 mb-2";
      viMosRecommend.innerText = "Waiting for input...";
      viMosRecommend.className = "px-3 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-600";
    }
  }

  if(viAllocPct) {
    [viAllocPct, viMosFair, viMosPrice].forEach(el => {
      if(el) el.addEventListener('input', updateVIRiskCalc);
    });
  }

  // Dashboard logic
  async function loadDashboard() {
    currentTraderPortfolio = await getPortfolio('trader');
    currentVIPortfolio = await getPortfolio('vi');
    
    // update calc-account-size to match trader portfolio (Trader mode is primary for risk calc)
    if(accountSizeInput) {
      accountSizeInput.value = currentTraderPortfolio.capital;
      updateRiskCalc();
    }
    
    const dashCapital = document.getElementById('dash-capital');
    const globalCapitalTrader = document.getElementById('global-capital-txt-trader');
    const globalCapitalVi = document.getElementById('global-capital-txt-vi');
    
    if(dashCapital) dashCapital.innerText = currentTraderPortfolio.capital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if(globalCapitalTrader) globalCapitalTrader.innerText = "$" + currentTraderPortfolio.capital.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2});
    if(globalCapitalVi) globalCapitalVi.innerText = "$" + currentVIPortfolio.capital.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2});
    
    updateVIRiskCalc();
    renderReallocation();
    
    const entries = await getJournalEntries('trader');
    
    let totalWin = 0;
    let winCount = 0;
    let appliedCount = 0;

    // Filter entries by timeframe (but only for those where isApplied !== false)
    const now = Date.now();
    let timeframeEntries = entries;
    if(currentDashboardTimeframe === 'month') {
      timeframeEntries = entries.filter(t => now - t.createdAt < 30 * 24 * 60 * 60 * 1000);
    } else if(currentDashboardTimeframe === 'week') {
      timeframeEntries = entries.filter(t => now - t.createdAt < 7 * 24 * 60 * 60 * 1000);
    }
    
    // Calculate PnL for filtered
    let timeframePnL = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let sumRR = 0;
    let validRRCount = 0;
    
    const renderJournal = (entries, targetId, isVI = false) => {
      const journalList = document.getElementById(targetId);
      if(!journalList) return;
      if(entries.length === 0) {
        journalList.innerHTML = `
          <div class="text-center py-16 px-4 bg-white/5 border border-white/10 rounded-3xl mt-4">
            <div class="text-5xl mb-4">📓</div>
            <h3 class="text-lg font-bold ${isVI ? 'text-gray-800' : 'text-white'} mb-2">No Trades Logged Yet</h3>
            <p class="text-sm text-gray-400 mb-6 max-w-xs mx-auto">Start tracking your trading performance to build discipline and consistency.</p>
            <button onclick="openTradeModal('${isVI ? 'vi' : 'trader'}')" class="btn-primary py-2 px-6 rounded-full font-bold shadow-lg shadow-[var(--accent-primary)]/30 hover:scale-105 transition-transform">
              + Add First Trade
            </button>
          </div>
        `;
      } else {
        journalList.innerHTML = '';
        entries.sort((a,b) => b.createdAt - a.createdAt).forEach(t => {
          const pnl = (t.sellPrice - t.buyPrice) * t.shares;
          const pnlPct = ((t.sellPrice - t.buyPrice) / t.buyPrice) * 100;
          const isApplied = t.isApplied !== false;
          
          let realizedRR = null;
          if(t.status === 'closed' && t.stopPrice && t.buyPrice !== t.stopPrice) {
            const riskPerShare = t.buyPrice - t.stopPrice;
            if(riskPerShare > 0) {
              realizedRR = (t.sellPrice - t.buyPrice) / riskPerShare;
            }
          }
          
          let styleClass = isVI 
            ? 'bg-white border border-gray-200 rounded-xl p-3 flex justify-between items-center' 
            : 'bg-[var(--card-dark)] border border-[var(--border-dark)] rounded-xl p-3 flex justify-between items-center';
            
          let textClass = isVI ? 'text-gray-800' : 'text-white';
          let mutedClass = isVI ? 'text-gray-500' : 'text-gray-400';
          let bgMutedClass = isVI ? 'bg-gray-100' : 'bg-gray-500/20';
          
          journalList.innerHTML += `
            <div class="${styleClass} ${isApplied ? '' : 'opacity-50'}">
              <div>
                <div class="font-bold flex items-center gap-2 ${textClass}">
                  ${t.symbol} 
                  ${t.status === 'open' ? '<span class="text-[9px] bg-blue-500/20 text-blue-500 px-1.5 py-0.5 rounded border border-blue-500/20">OPEN</span>' : ''}
                  ${!isApplied ? `<span class="text-[9px] ${bgMutedClass} ${mutedClass} px-1.5 py-0.5 rounded">Not in Port</span>` : ''}
                  ${realizedRR !== null ? `<span class="text-[9px] ${realizedRR >= 1 ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'} px-1.5 py-0.5 rounded border ${realizedRR >= 1 ? 'border-green-500/20' : 'border-red-500/20'}">${realizedRR.toFixed(1)}R</span>` : ''}
                </div>
                <div class="text-[10px] ${mutedClass}">Buy: $${t.buyPrice} ${t.status === 'closed' ? `| Sell: $${t.sellPrice}` : ''} | ${t.shares} shares</div>
              </div>
              <div class="text-right flex items-center gap-2">
                <div>
                  ${t.status === 'closed' ? `
                    <div class="font-bold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</div>
                    <div class="text-[10px] ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</div>
                  ` : `
                    <div class="font-bold text-gray-400">Hold</div>
                  `}
                </div>
                <div class="flex flex-col gap-1 ml-2 border-l ${isVI ? 'border-gray-200' : 'border-white/10'} pl-2">
                  <button onclick="editTrade(${t.id}, '${isVI ? 'vi' : 'trader'}')" class="text-xs text-blue-500 hover:text-blue-400">✏️</button>
                  <button onclick="deleteTrade(${t.id}, '${isVI ? 'vi' : 'trader'}')" class="text-xs text-red-500 hover:text-red-400">🗑️</button>
                </div>
              </div>
            </div>
          `;
        });
      }
    };
    
    renderJournal(entries, 'journal-list', false);
    
    const viEntries = await getJournalEntries('vi');
    renderJournal(viEntries, 'vi-journal-list', true);
    
    // Dash PnL uses timeframePnL instead of All-time if not 'all'
    let displayPnL = timeframePnL;
    let displayCapital = currentDashboardTimeframe === 'all' ? currentTraderPortfolio.initialCapital : (currentTraderPortfolio.capital - timeframePnL);
    if(displayCapital <= 0) displayCapital = 1; // fallback
    const displayPnLPct = (displayPnL / displayCapital) * 100;
    
    const dashPnl = document.getElementById('dash-pnl');
    const dashPnlPct = document.getElementById('dash-pnl-pct');
    if(dashPnl) {
      dashPnl.innerText = `${displayPnL >= 0 ? '+' : ''}$${displayPnL.toFixed(2)}`;
      dashPnl.className = `text-lg font-bold ${displayPnL >= 0 ? 'text-green-400' : 'text-red-400'}`;
    }
    if(dashPnlPct) {
      dashPnlPct.innerText = `${displayPnL >= 0 ? '+' : ''}${displayPnLPct.toFixed(1)}%`;
      dashPnlPct.className = `text-xs px-2 py-0.5 rounded inline-block ${displayPnL >= 0 ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`;
      
      // Update label
      const lbl = dashPnlPct.previousElementSibling;
      if(lbl) lbl.innerText = currentDashboardTimeframe === 'all' ? 'All-Time PnL' : (currentDashboardTimeframe === 'month' ? '1M PnL' : '1W PnL');
    }
    
    const dashWinrate = document.getElementById('dash-winrate');
    if(dashWinrate) {
      const wr = appliedCount > 0 ? (winCount / appliedCount) * 100 : 0;
      dashWinrate.innerText = `${wr.toFixed(1)}%`;
    }
    
    const dashTradesCount = document.getElementById('dash-trades-count');
    if(dashTradesCount) {
      dashTradesCount.innerText = appliedCount;
    }
    
    const dashAvgRR = document.getElementById('dash-avg-rr');
    if(dashAvgRR) {
      const avgRR = validRRCount > 0 ? (sumRR / validRRCount) : 0;
      dashAvgRR.innerText = `${avgRR.toFixed(2)}R`;
      dashAvgRR.className = `text-xl font-bold ${avgRR >= 1 ? 'text-yellow-400' : 'text-gray-400'}`;
    }
    
    const dashPF = document.getElementById('dash-pf');
    if(dashPF) {
      let pf = 0;
      if(grossLoss === 0) pf = grossProfit > 0 ? 99.99 : 0;
      else pf = grossProfit / grossLoss;
      
      dashPF.innerText = pf === 99.99 ? 'MAX' : pf.toFixed(2);
      dashPF.className = `text-xl font-bold ${pf >= 1.5 ? 'text-purple-400' : (pf >= 1 ? 'text-green-400' : 'text-red-400')}`;
    }

    // Top Performers grouping (only Applied and within timeframe)
    const dashTopPerformers = document.getElementById('dash-top-performers');
    if(dashTopPerformers) {
      const validEntries = timeframeEntries.filter(t => t.isApplied !== false && t.status === 'closed');
      if(validEntries.length === 0) {
        dashTopPerformers.innerHTML = '<div class="text-center text-gray-500 text-sm py-4">No data yet.</div>';
      } else {
        const symbolAgg = {};
        validEntries.forEach(t => {
          const pnl = (t.sellPrice - t.buyPrice) * t.shares;
          if(!symbolAgg[t.symbol]) symbolAgg[t.symbol] = { symbol: t.symbol, pnl: 0, count: 0 };
          symbolAgg[t.symbol].pnl += pnl;
          symbolAgg[t.symbol].count += 1;
        });

        const sortedPerformers = Object.values(symbolAgg).sort((a,b) => b.pnl - a.pnl);
        
        dashTopPerformers.innerHTML = '';
        sortedPerformers.forEach(p => {
          dashTopPerformers.innerHTML += `
            <div class="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg border border-white/5">
              <div class="flex items-center gap-2">
                <span class="font-bold text-sm">${p.symbol}</span>
                <span class="text-[10px] text-gray-400">${p.count} trades</span>
              </div>
              <div class="font-bold text-sm ${p.pnl >= 0 ? 'text-green-400' : 'text-red-400'}">
                ${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)}
              </div>
            </div>
          `;
        });
      }
    }
  }

  window.setTimeframe = function(tf) {
    currentDashboardTimeframe = tf;
    
    // Update button states
    ['all', 'month', 'week'].forEach(id => {
      const btn = document.getElementById('btn-tf-' + id);
      if(btn) {
        if(id === tf) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    });

    loadDashboard();
  };

  // Load dashboard on init
  loadDashboard();

  // Expose function to global scope for the inline onclick handlers in HTML
  window.applyToRiskCalc = function(symbol, entry, stop, target, risk) {
    if(entryPriceInput) entryPriceInput.value = entry;
    if(stopLossInput) stopLossInput.value = stop;
    if(targetPriceInput) targetPriceInput.value = target;
    if(riskPctInput) riskPctInput.value = risk;
    
    updateRiskCalc();
    
    if(typeof window.switchTraderTab === 'function') {
      window.switchTraderTab('trader-risk');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  window.openCapitalModal = function(type = 'trader') {
    currentCapitalEditingType = type;
    const port = type === 'vi' ? currentVIPortfolio : currentTraderPortfolio;
    
    document.getElementById('input-edit-capital').value = port ? port.capital : 550;
    
    const modal = document.getElementById('capital-modal');
    const sheet = document.getElementById('capital-sheet');
    modal.classList.remove('hidden');
    setTimeout(() => {
      modal.classList.remove('opacity-0');
      sheet.classList.remove('scale-95');
    }, 10);
  };
  
  window.closeCapitalModal = function() {
    const modal = document.getElementById('capital-modal');
    const sheet = document.getElementById('capital-sheet');
    modal.classList.add('opacity-0');
    sheet.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
  };
  
  window.saveCapital = async function() {
    const newCap = parseFloat(document.getElementById('input-edit-capital').value);
    if(newCap && newCap > 0) {
      const type = currentCapitalEditingType;
      const port = type === 'vi' ? currentVIPortfolio : currentTraderPortfolio;
      const initial = port && port.initialCapital ? port.initialCapital : newCap;
      
      await updatePortfolio({ capital: newCap, initialCapital: initial }, type);
      closeCapitalModal();
      loadDashboard();
    }
  };

  let editingTradeId = null;
  let currentTradeStatus = 'closed';
  let currentTradeEditingType = 'trader';

  window.setTradeStatus = function(status) {
    currentTradeStatus = status;
    const btnOpen = document.getElementById('btn-status-open');
    const btnClosed = document.getElementById('btn-status-closed');
    const wrapSell = document.getElementById('wrapper-trade-sell');
    const sellInput = document.getElementById('trade-sell');
    
    if(status === 'open') {
      btnOpen.className = "flex-1 py-1.5 text-xs font-bold rounded bg-[var(--accent-primary)] text-white shadow-md";
      btnClosed.className = "flex-1 py-1.5 text-xs font-bold rounded text-gray-400 hover:text-white transition-colors";
      if(wrapSell) {
        wrapSell.classList.remove('hidden');
        wrapSell.classList.add('opacity-30', 'pointer-events-none');
      }
      if(sellInput) sellInput.value = ''; // clear sell price if opened
    } else {
      btnClosed.className = "flex-1 py-1.5 text-xs font-bold rounded bg-[var(--card-dark)] text-white shadow-md";
      btnOpen.className = "flex-1 py-1.5 text-xs font-bold rounded text-gray-400 hover:text-white transition-colors";
      if(wrapSell) {
        wrapSell.classList.remove('hidden', 'opacity-30', 'pointer-events-none');
      }
    }
  };

  window.openTradeModal = function(type = 'trader') {
    editingTradeId = null;
    currentTradeEditingType = type;
    setTradeStatus('closed');
    document.getElementById('trade-symbol').value = '';
    document.getElementById('trade-buy').value = '';
    document.getElementById('trade-sell').value = '';
    document.getElementById('trade-shares').value = '';
    document.getElementById('trade-stop').value = '';
    document.getElementById('trade-target').value = '';
    
    const modal = document.getElementById('trade-modal');
    const sheet = document.getElementById('trade-sheet');
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); sheet.classList.remove('translate-y-full'); }, 10);
  };
  
  window.closeTradeModal = function() {
    const modal = document.getElementById('trade-modal');
    const sheet = document.getElementById('trade-sheet');
    modal.classList.add('opacity-0');
    sheet.classList.add('translate-y-full');
    setTimeout(() => modal.classList.add('hidden'), 300);
  };

  window.saveTrade = async function() {
    const symbol = document.getElementById('trade-symbol').value.toUpperCase();
    const buyPrice = parseFloat(document.getElementById('trade-buy').value);
    let sellPrice = parseFloat(document.getElementById('trade-sell').value);
    const shares = parseFloat(document.getElementById('trade-shares').value);
    const stopPrice = parseFloat(document.getElementById('trade-stop').value);
    const targetPrice = parseFloat(document.getElementById('trade-target').value);
    
    if(currentTradeStatus === 'open') {
      sellPrice = null; // Ignore sell price
      if(!symbol || isNaN(buyPrice) || isNaN(shares)) {
        showToast("Please fill Symbol, Buy Price, and Shares correctly.", "error");
        return;
      }
    } else {
      if(!symbol || isNaN(buyPrice) || isNaN(sellPrice) || isNaN(shares)) {
        showToast("Please fill all required fields correctly for a closed trade.", "error");
        return;
      }
    }
    
    const entryData = {
      symbol, buyPrice, sellPrice, shares, status: currentTradeStatus,
      stopPrice: isNaN(stopPrice) ? null : stopPrice,
      targetPrice: isNaN(targetPrice) ? null : targetPrice,
      type: currentTradeEditingType
    };
    
    if(editingTradeId) {
      const entries = await getJournalEntries(currentTradeEditingType);
      const existing = entries.find(e => e.id === editingTradeId);
      if(existing) {
        Object.assign(existing, entryData);
        await updateJournalEntry(existing);
      }
    } else {
      entryData.isApplied = true;
      await addJournalEntry(entryData);
    }
    
    // Auto-Sync full capital recalculation to be safe
    await runCapitalSync(currentTradeEditingType);
    
    closeTradeModal();
  };

  window.editTrade = async function(id, type = 'trader') {
    const entries = await getJournalEntries(type);
    const t = entries.find(e => e.id === id);
    if(t) {
      editingTradeId = id;
      currentTradeEditingType = type;
      setTradeStatus(t.status || 'closed');
      document.getElementById('trade-symbol').value = t.symbol;
      document.getElementById('trade-buy').value = t.buyPrice;
      document.getElementById('trade-sell').value = t.sellPrice || '';
      document.getElementById('trade-shares').value = t.shares;
      document.getElementById('trade-stop').value = t.stopPrice || '';
      document.getElementById('trade-target').value = t.targetPrice || '';
      
      const modal = document.getElementById('trade-modal');
      const sheet = document.getElementById('trade-sheet');
      modal.classList.remove('hidden');
      setTimeout(() => { modal.classList.remove('opacity-0'); sheet.classList.remove('translate-y-full'); }, 10);
    }
  };

  window.deleteTrade = async function(id, type = 'trader') {
    if(confirm("Are you sure you want to delete this trade?")) {
      await deleteJournalEntry(id);
      await runCapitalSync(type);
    }
  };

  async function runCapitalSync(type = 'trader') {
    const entries = await getJournalEntries(type);
    let totalPnL = 0;
    entries.forEach(t => {
      if(t.isApplied !== false) {
        if(t.status === 'closed') {
          totalPnL += (t.sellPrice - t.buyPrice) * t.shares;
        }
      }
    });
    
    if(type === 'trader' && currentTraderPortfolio) {
      const newCap = currentTraderPortfolio.initialCapital + totalPnL;
      await updatePortfolio({ capital: newCap, initialCapital: currentTraderPortfolio.initialCapital }, 'trader');
      await loadDashboard();
    } else if (type === 'vi' && currentVIPortfolio) {
      const newCap = currentVIPortfolio.initialCapital + totalPnL;
      await updatePortfolio({ capital: newCap, initialCapital: currentVIPortfolio.initialCapital }, 'vi');
      await loadDashboard();
    }
  }

  // --- Sync Modal Logic ---
  let syncEntriesCache = [];
  
  window.openSyncModal = async function() {
    syncEntriesCache = await getJournalEntries();
    syncEntriesCache.sort((a,b) => b.createdAt - a.createdAt);
    
    renderSyncList();
    
    const modal = document.getElementById('sync-modal');
    const sheet = document.getElementById('sync-sheet');
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); sheet.classList.remove('translate-y-full'); }, 10);
  };

  window.closeSyncModal = function() {
    const modal = document.getElementById('sync-modal');
    const sheet = document.getElementById('sync-sheet');
    modal.classList.add('opacity-0');
    sheet.classList.add('translate-y-full');
    setTimeout(() => modal.classList.add('hidden'), 300);
  };

  function renderSyncList() {
    const list = document.getElementById('sync-trade-list');
    list.innerHTML = '';
    
    let previewPnL = 0;
    
    syncEntriesCache.forEach((t, index) => {
      const pnl = (t.sellPrice - t.buyPrice) * t.shares;
      const isApplied = t.isApplied !== false;
      if(isApplied) previewPnL += pnl;
      
      list.innerHTML += `
        <div class="bg-white/5 border border-white/5 rounded-xl p-3 flex justify-between items-center ${isApplied ? '' : 'opacity-50'}">
          <div class="flex items-center gap-3">
            <input type="checkbox" class="w-5 h-5 accent-blue-500" ${isApplied ? 'checked' : ''} onchange="toggleSyncTrade(${index}, this.checked)">
            <div>
              <div class="font-bold">${t.symbol}</div>
              <div class="text-[10px] text-gray-400">$${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</div>
            </div>
          </div>
        </div>
      `;
    });
    
    const newCap = currentTraderPortfolio.initialCapital + previewPnL;
    document.getElementById('sync-preview-capital').innerText = '$' + newCap.toLocaleString(undefined, {minimumFractionDigits:2});
  }

  window.toggleSyncTrade = function(index, checked) {
    syncEntriesCache[index].isApplied = checked;
    renderSyncList(); // re-render to update UI and preview capital
  };

  window.confirmSync = async function() {
    // Save all entries
    for (let t of syncEntriesCache) {
      await updateJournalEntry(t);
    }
    await runCapitalSync();
    closeSyncModal();
  };

  // Watchlist logic
  async function loadWatchlist(type = 'trader') {
    const wl = await getWatchlistDB(type);
    const watchEl = document.getElementById(type === 'vi' ? 'vi-watch-list' : 'watch-list');
    if(!watchEl) return;
    
    if(wl.length === 0) {
      watchEl.innerHTML = `
        <div class="text-center py-12 px-4 bg-[var(--card-dark)] border border-[var(--border-dark)] rounded-3xl mt-4">
          <div class="text-5xl mb-3">🔭</div>
          <h3 class="text-lg font-bold ${type === 'trader' ? 'text-white' : 'text-gray-800'} mb-1">Watchlist Empty</h3>
          <p class="text-sm text-gray-400">Add symbols above to track potential setups.</p>
        </div>
      `;
      return;
    }
    
    watchEl.innerHTML = '';
    wl.sort((a,b) => b.addedAt - a.addedAt).forEach(item => {
      watchEl.innerHTML += `
        <div class="bg-[var(--card-dark)] border border-[var(--border-dark)] rounded-xl p-4 flex justify-between items-center relative overflow-hidden">
          <div class="flex items-center gap-3 relative z-10">
            <div class="font-black text-xl tracking-tight">${item.symbol}</div>
            <span class="pill bg-yellow-900/40 text-yellow-400 border border-yellow-500/20 text-[10px] px-2">⭐ Saved</span>
          </div>
          <button onclick="removeWatchlist('${item.symbol}', '${type}')" class="w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center text-red-400 font-bold transition-colors relative z-10">
            ✕
          </button>
        </div>
      `;
    });
  }

  window.addWatchlist = async function(type = 'trader') {
    const input = document.getElementById(type === 'vi' ? 'vi-watch-input' : 'watch-input');
    const symbol = input.value.trim().toUpperCase();
    if(symbol) {
      await addWatchlistDB(symbol, type);
      input.value = '';
      loadWatchlist(type);
    }
  };

  window.removeWatchlist = async function(symbol, type = 'trader') {
    await removeWatchlistDB(symbol, type);
    loadWatchlist(type);
  };

  // VI Reallocation Engine
  window.evaluateHoldings = async function() {
    const entries = await getJournalEntries();
    const openTrades = entries.filter(t => t.status === 'open');
    const listEl = document.getElementById('vi-reallocate-list');
    
    if(!listEl) return;
    
    if(openTrades.length === 0) {
      listEl.innerHTML = `
        <div class="text-center text-gray-400 text-sm py-6 bg-gray-50 rounded-xl border border-gray-200">
          ไม่มีรายการหุ้นที่ถืออยู่<br>
          <span class="text-xs">กดเพิ่มไม้เทรดใน Journal แบบ Open เพื่อเริ่มใช้งาน</span>
        </div>
      `;
      return;
    }
    
    listEl.innerHTML = '';
    
    openTrades.forEach(t => {
      // Phase 1.8 Mock Data Generator (Deterministic for Demo)
      let currentPrice = t.buyPrice;
      let dcfValue = t.buyPrice;
      
      if(t.symbol === 'AAPL') {
        currentPrice = t.buyPrice * 0.95; // Down 5%
        dcfValue = t.buyPrice * 1.30; // 30% upside to DCF
      } else if(t.symbol === 'NVDA') {
        currentPrice = t.buyPrice * 1.50; // Up 50%
        dcfValue = t.buyPrice * 1.10; // Current way above DCF
      } else {
        const charCodeSum = t.symbol.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const mod = charCodeSum % 3;
        if(mod === 0) {
          currentPrice = t.buyPrice * 1.1; dcfValue = t.buyPrice * 1.05;
        } else if (mod === 1) {
          currentPrice = t.buyPrice * 0.8; dcfValue = t.buyPrice * 1.2;
        } else {
          currentPrice = t.buyPrice * 1.05; dcfValue = t.buyPrice * 1.2;
        }
      }
      
      const unPnl = (currentPrice - t.buyPrice) * t.shares;
      const unPnlPct = ((currentPrice - t.buyPrice) / t.buyPrice) * 100;
      
      let action = 'HOLD';
      let actionColor = 'bg-gray-100 text-gray-600 border border-gray-200';
      
      if(currentPrice > dcfValue * 1.2) {
        action = 'SELL ALL';
        actionColor = 'bg-red-100 text-red-600 border border-red-200';
      } else if (currentPrice > dcfValue) {
        action = 'TAKE PROFIT';
        actionColor = 'bg-orange-100 text-orange-600 border border-orange-200';
      } else if (currentPrice < dcfValue * 0.8) {
        action = 'BUY MORE';
        actionColor = 'bg-green-100 text-green-600 border border-green-200';
      }
      
      listEl.innerHTML += `
        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
          <div class="flex justify-between items-center">
            <div class="font-bold text-lg text-gray-800">${t.symbol} <span class="text-xs font-normal text-gray-400 ml-1">(${t.shares} shares)</span></div>
            <div class="px-2 py-1 rounded text-[10px] font-bold ${actionColor}">${action}</div>
          </div>
          
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div class="text-[10px] text-gray-400">Avg Cost</div>
              <div class="font-semibold text-gray-700">$${t.buyPrice.toFixed(2)}</div>
            </div>
            <div>
              <div class="text-[10px] text-gray-400">Current Price (Mock)</div>
              <div class="font-semibold text-gray-700">$${currentPrice.toFixed(2)}</div>
            </div>
            <div>
              <div class="text-[10px] text-gray-400">Unrealized PnL</div>
              <div class="font-bold ${unPnl >= 0 ? 'text-green-500' : 'text-red-500'}">${unPnl >= 0 ? '+' : ''}$${unPnl.toFixed(2)} (${unPnlPct.toFixed(1)}%)</div>
            </div>
            <div>
              <div class="text-[10px] text-gray-400">DCF Value</div>
              <div class="font-semibold text-blue-600">$${dcfValue.toFixed(2)}</div>
            </div>
          </div>
        </div>
      `;
    });
  };

  // Backup & Restore
  window.exportBackup = async function() {
    try {
      const data = await exportAllData();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const dateStr = new Date().toISOString().split('T')[0];
      const a = document.createElement('a');
      a.href = url;
      a.download = `riskfirst-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Backup exported successfully!", "success");
    } catch (e) {
      showToast("Error exporting data: " + e.message, "error");
    }
  };

  window.importBackup = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const jsonData = JSON.parse(e.target.result);
        if (!confirm("⚠️ This will overwrite all your current data. Are you sure you want to proceed?")) {
          return;
        }
        await importAllData(jsonData);
        showToast("Backup imported successfully!", "success");
        setTimeout(() => window.location.reload(), 1000); // Reload to refresh all state
      } catch (err) {
        showToast("Error parsing backup file: " + err.message, "error");
      }
    };
    reader.readAsText(file);
    // Reset file input so the same file can be selected again
    event.target.value = '';
  };

  // Finnhub API Integration
  const apiKeyInput = document.getElementById('input-api-key');
  if(apiKeyInput) {
    apiKeyInput.value = localStorage.getItem('finnhubApiKey') || '';
  }

  window.saveApiKey = function() {
    const key = document.getElementById('input-api-key').value.trim();
    if(key) {
      localStorage.setItem('finnhubApiKey', key);
      showToast('API Key saved successfully!', 'success');
    } else {
      localStorage.removeItem('finnhubApiKey');
      showToast('API Key removed.', 'info');
    }
  };

  // Sync Prices with Finnhub
  window.syncPrices = async function() {
    const apiKey = localStorage.getItem('finnhubApiKey');
    if(!apiKey) {
      showToast("Please enter your Finnhub API Key in the Info (ℹ️) menu first.", "warning");
      openGlobalLogicModal();
      return;
    }

    try {
      // Get all unique symbols from journal and watchlist
      const traderJournal = await getJournalEntries('trader');
      const viJournal = await getJournalEntries('vi');
      
      const allSymbols = new Set();
      [...traderJournal, ...viJournal].forEach(t => {
        if(t.status === 'open') allSymbols.add(t.symbol);
      });
      
      if(allSymbols.size === 0) {
        showToast("No open positions to sync.", "info");
        return;
      }
      
      const syncBtn = document.querySelector('button[onclick="syncPrices()"]');
      const origText = syncBtn.innerHTML;
      syncBtn.innerHTML = '<span>⏳</span> Syncing...';
      syncBtn.disabled = true;

      // Fetch prices for all open symbols
      // Finnhub free tier limit is 30 API calls/second, so we can do Promise.all safely for a small portfolio
      const fetchPromises = Array.from(allSymbols).map(async (symbol) => {
        try {
          const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
          const data = await res.json();
          if(data && data.c) { // 'c' is current price in Finnhub
            return { symbol, price: data.c };
          }
        } catch(e) {
          console.error(`Failed to fetch ${symbol}:`, e);
        }
        return null;
      });

      const results = await Promise.all(fetchPromises);
      let updatedCount = 0;
      
      // Update journal entries with new prices (simulated by updating their 'currentPrice' or we just use it for rendering?)
      // Actually, our journal entries don't store 'currentPrice', we just use Mock prices in `evaluateHoldings`!
      // Let's store the fetched prices in localStorage for simplicity and use them in rendering.
      const priceCache = JSON.parse(localStorage.getItem('priceCache') || '{}');
      
      results.forEach(res => {
        if(res) {
          priceCache[res.symbol] = res.price;
          updatedCount++;
        }
      });
      
      localStorage.setItem('priceCache', JSON.stringify(priceCache));
      
      showToast(`Synced latest prices for ${updatedCount} stocks.`, "success");
      
      // Re-render
      loadDashboard();
      renderReallocation();
      evaluateHoldings();
      
      syncBtn.innerHTML = origText;
      syncBtn.disabled = false;
      
    } catch (e) {
      showToast("Error syncing prices: " + e.message, "error");
    }
  };

  // Portfolio Reallocation Logic (VI)
  window.renderReallocation = async function() {
    const listEl = document.getElementById('vi-realloc-list');
    if(!listEl) return;
    
    if(!currentVIPortfolio) currentVIPortfolio = await getPortfolio('vi');
    const entries = await getJournalEntries('vi');
    const openPositions = entries.filter(t => t.status === 'open');
    
      listEl.innerHTML = `
        <div class="text-center py-10 px-4 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm mt-2">
          <div class="text-4xl mb-3">⚖️</div>
          <h3 class="text-lg font-bold text-gray-800 mb-1">Portfolio Balanced</h3>
          <p class="text-xs text-gray-500">No open positions to rebalance.</p>
        </div>
      `;
    }
    
    const priceCache = JSON.parse(localStorage.getItem('priceCache') || '{}');
    
    // Group by symbol to calculate total current value
    const holdings = {};
    openPositions.forEach(t => {
      if(!holdings[t.symbol]) {
        holdings[t.symbol] = { shares: 0, cost: 0, currentPrice: priceCache[t.symbol] || t.buyPrice };
      }
      holdings[t.symbol].shares += t.shares;
      holdings[t.symbol].cost += (t.shares * t.buyPrice);
    });
    
    listEl.innerHTML = '';
    
    Object.keys(holdings).forEach(symbol => {
      const h = holdings[symbol];
      const currentValue = h.shares * h.currentPrice;
      const currentPct = currentVIPortfolio.capital > 0 ? (currentValue / currentVIPortfolio.capital) * 100 : 0;
      
      // We will store target percent in localStorage per symbol for simplicity
      const targetPct = parseFloat(localStorage.getItem(`vi_target_${symbol}`)) || 0;
      const targetValue = currentVIPortfolio.capital * (targetPct / 100);
      const diffValue = targetValue - currentValue;
      
      let actionHtml = '';
      if(diffValue > 0) {
        const sharesToBuy = Math.floor(diffValue / h.currentPrice);
        actionHtml = `<div class="text-green-600 font-bold text-xs mt-1">BUY ~$${diffValue.toFixed(2)} (${sharesToBuy} shares)</div>`;
      } else if (diffValue < -1) {
        const sharesToSell = Math.floor(Math.abs(diffValue) / h.currentPrice);
        actionHtml = `<div class="text-red-500 font-bold text-xs mt-1">SELL ~$${Math.abs(diffValue).toFixed(2)} (${sharesToSell} shares)</div>`;
      } else {
        actionHtml = `<div class="text-gray-400 font-bold text-xs mt-1">BALANCED</div>`;
      }
      
      listEl.innerHTML += `
        <div class="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow rounded-2xl p-5 flex flex-col gap-3">
          <div class="flex justify-between items-center border-b border-gray-100 pb-3">
            <div class="font-black text-2xl text-gray-800 tracking-tight">${symbol}</div>
            <div class="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
              <label class="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Target</label>
              <div class="flex items-center gap-1">
                <input type="number" value="${targetPct}" onchange="updateTargetPct('${symbol}', this.value)" class="w-12 bg-transparent text-lg font-black text-blue-600 text-right focus:outline-none">
                <span class="text-sm font-bold text-gray-400">%</span>
              </div>
            </div>
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div class="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <div class="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Current Alloc</div>
              <div class="font-black text-xl text-gray-700 leading-none mb-1">$${currentValue.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
              <div class="text-xs font-bold text-gray-500">${currentPct.toFixed(1)}% of Port</div>
            </div>
            <div class="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <div class="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Target Value</div>
              <div class="font-black text-xl text-gray-700 leading-none">$${targetValue.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
            </div>
          </div>
          <div class="mt-1 flex justify-center">
            ${actionHtml.replace('text-xs', 'text-sm px-4 py-2 bg-white rounded-xl shadow-sm border').replace('mt-1', '')}
          </div>
        </div>
      `;
    });
  };

  window.updateTargetPct = function(symbol, val) {
    localStorage.setItem(`vi_target_${symbol}`, val);
    renderReallocation();
  };

  // Initial load
  loadWatchlist('trader');
  loadWatchlist('vi');
  evaluateHoldings();

});
