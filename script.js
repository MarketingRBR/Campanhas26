/* =========================================================================
   RBR — PAINEL EXECUTIVO DE CAMPANHAS DE VENDA
   Motor de dados, regras de negócio, filtros (dropdown-checklist), abas,
   gráficos, tabelas, alertas, importação e exportação.
   ========================================================================= */

const COLORS = {
  cobalto:'#005E96', indigo:'#133F68', royal:'#0D96D4', ceu:'#44C8F5',
  grafite:'#B6B8BA', tiffany:'#19B2AC', critico:'#C0392B', atencao:'#E0962B', good:'#1f9d72'
};

let DATA = [];
const HOJE = new Date(2026, 5, 25); // 25/06/2026 — data de referência do painel

/* ---------------------------------------------------------------------
   1. NORMALIZAÇÃO / DETECÇÃO AUTOMÁTICA DE COLUNAS
   ------------------------------------------------------------------- */
const HEADER_MAP = {
  'FÁBRICA':'fabrica','FABRICA':'fabrica','MARCA':'fabrica','CLIENTE':'cliente','CIDADE':'cidade',
  'UF':'uf','ESTADO':'uf','MÊS COMPETÊNCIA':'mes','MES COMPETENCIA':'mes','MÊS':'mes',
  'TIPO DE CAMPANHA':'tipoCampanha','MECÂNICA DA CAMPANHA':'mecanica','MECANICA DA CAMPANHA':'mecanica',
  'PREMIAÇÃO':'premiacao','PREMIACAO':'premiacao','STATUS DA CAMPANHA':'status',
  'CUSTO PREVISTO':'custoPrevisto','CUSTO FINAL':'custoFinal','INVESTIMENTO':'investimentoOrigem',
  'META':'metaTipo','MÉDIA ANTES DA CAMPANHA':'mediaAntes','MEDIA ANTES DA CAMPANHA':'mediaAntes',
  'META CAMPANHA':'metaCampanha','REALIZADO DURANTE A CAMPANHA':'realizado',
  'DATA DE ÍNICIO':'dataInicio','DATA DE INICIO':'dataInicio','DATA DE TÉRMINO':'dataFim','DATA DE TERMINO':'dataFim',
  'DATA DE PAGAMENTO':'dataPagamento','RESPONSÁVEL DO CLIENTE POR AUTORIZAR A CAMPANHA':'responsavel',
  'META ATINGIDA':'metaAtingida'
};

const UF_REGION = {
  PE:'Nordeste',BA:'Nordeste',PB:'Nordeste',RN:'Nordeste',AL:'Nordeste',SE:'Nordeste',PI:'Nordeste',CE:'Nordeste',MA:'Nordeste',
  SP:'Sudeste',RJ:'Sudeste',MG:'Sudeste',ES:'Sudeste',PR:'Sul',SC:'Sul',RS:'Sul',
  GO:'Centro-Oeste',MT:'Centro-Oeste',MS:'Centro-Oeste',DF:'Centro-Oeste',
  AM:'Norte',PA:'Norte',AC:'Norte',RO:'Norte',RR:'Norte',AP:'Norte',TO:'Norte'
};

// Posições aproximadas em grade 4x4 para o "mapa de calor" dos estados do Nordeste
const UF_GRID_POS = {
  MA:[0,0], PI:[0,1], CE:[0,2], RN:[0,3],
  PE:[1,2], PB:[1,3],
  AL:[2,2], SE:[2,3],
  BA:[3,1]
};

function normalizeHeader(h){ return String(h||'').trim().toUpperCase().replace(/\s+/g,' '); }

function categorizaCampanha(premiacao){
  const p = String(premiacao||'').toUpperCase();
  if(p.includes('DINHEIRO')) return 'Cashback';
  if(p.includes('VALE')) return 'Vale-compras';
  if(p.includes('VIAGEM')) return 'Viagem';
  if(p.includes('PONTU')) return 'Pontuação';
  if(p.includes('CARTÃO')||p.includes('CARTAO')) return 'Bonificação';
  if(p.includes('BRINDE')||p.includes('CAMISA')||p.includes('KIT')||p.includes('OVOS')||p.includes('CHOCOLATE')||p.includes('CERVEJA')) return 'Brindes';
  return 'Outros';
}

function classifyFaixa(pct){
  if(pct===null||pct===undefined||isNaN(pct)) return 'Sem Meta';
  if(pct<80) return 'Crítico';
  if(pct<100) return 'Atenção';
  if(pct<120) return 'Meta Atingida';
  return 'Super Performance';
}

function mesToAno(mes){
  if(!mes) return null;
  const m = String(mes).match(/(\d{2,4})$/);
  if(!m) return null;
  let y = m[1]; if(y.length===2) y = '20'+y;
  return y;
}

const MES_ORDER = {jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12};
function mesSortKey(mes){
  if(!mes) return 9999;
  const parts = String(mes).toLowerCase().split('-');
  const mm = MES_ORDER[parts[0]]||0;
  let yy = parseInt(parts[1]||'0',10); if(yy<100) yy+=2000;
  return yy*100+mm;
}

function parseDateBR(iso){
  if(!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// Calcula todos os campos derivados de uma campanha (regras de negócio)
function finalizeRecord(r){
  r.uf = (r.uf||'').trim().toUpperCase();
  r.regiao = r.regiao || UF_REGION[r.uf] || 'Outras';
  r.categoriaCampanha = categorizaCampanha(r.premiacao);
  r.ano = mesToAno(r.mes);

  const metaNum = (typeof r.metaCampanha === 'number') ? r.metaCampanha : null;
  r.pctAtingimento = (metaNum && metaNum>0) ? Math.round((r.realizado/metaNum)*10000)/100 : null;
  r.faixaPerformance = classifyFaixa(r.pctAtingimento);

  // Crescimento % vs. média antes da campanha
  r.growthPct = (r.mediaAntes && r.mediaAntes>0) ? Math.round(((r.realizado-r.mediaAntes)/r.mediaAntes)*10000)/100 : null;

  // ROI = Realizado (crescimento realizado) ÷ Custo Final
  r.roi = (r.custoFinal && r.custoFinal>0) ? Math.round((r.realizado/r.custoFinal)*100)/100 : null;

  // Alertas
  const fim = parseDateBR(r.dataFim);
  r.alertaVencidaSemFechamento = !!(fim && fim < HOJE && r.status !== 'CONCLUÍDA');
  r.alertaSemPagamento = !!(r.metaAtingida === 'Sim' && !r.dataPagamento);
  r.alertaCustoAcima = !!(r.custoPrevisto>0 && r.custoFinal > r.custoPrevisto);
  r.alertaCrescimentoNegativo = (r.growthPct !== null && r.growthPct < 0);

  return r;
}

function rowFromImported(headers, row){
  const rec = {};
  headers.forEach((h,i)=>{ const key = HEADER_MAP[normalizeHeader(h)]; if(key) rec[key]=row[i]; });
  if(!rec.fabrica) return null;
  rec.custoPrevisto = parseFloat(rec.custoPrevisto)||0;
  rec.custoFinal = parseFloat(rec.custoFinal)||0;
  let metaRaw = rec.metaCampanha;
  rec.semMeta = (typeof metaRaw==='string' && metaRaw.toUpperCase().includes('SEM META'));
  rec.metaCampanha = (typeof metaRaw==='number') ? metaRaw : (parseFloat(metaRaw)||null);
  rec.realizado = parseFloat(rec.realizado)||0;
  rec.mediaAntes = parseFloat(rec.mediaAntes)||null;
  return finalizeRecord(rec);
}

function loadEmbeddedData(){ DATA = (RBR_RAW_DATA||[]).map(r => finalizeRecord({...r})); }

/* ---------------------------------------------------------------------
   2. FILTROS — DROPDOWN-CHECKLIST (estilo Power BI)
   ------------------------------------------------------------------- */
const FILTER_DEFS = [
  {field:'fabrica', label:'Marca', dynamic:true},
  {field:'cliente', label:'Cliente', dynamic:true},
  {field:'regiao', label:'Região', dynamic:true},
  {field:'uf', label:'UF', dynamic:true},
  {field:'mes', label:'Mês', dynamic:true, sortFn:mesSortKey},
  {field:'ano', label:'Ano', dynamic:true},
  {field:'categoriaCampanha', label:'Tipo Campanha', dynamic:true},
  {field:'status', label:'Status', options:[{value:'EM ANDAMENTO',label:'Ativa'},{value:'CONCLUÍDA',label:'Encerrada'}]},
  {field:'metaAtingida', label:'Meta Atingida', options:[{value:'Sim',label:'Sim'},{value:'Não',label:'Não'}]},
  {field:'faixaPerformance', label:'Faixa Performance', options:[
    {value:'Crítico',label:'Crítico (<80%)'},{value:'Atenção',label:'Atenção (80–99%)'},
    {value:'Meta Atingida',label:'Meta Atingida (100–119%)'},{value:'Super Performance',label:'Super Performance (≥120%)'},
    {value:'Sem Meta',label:'Sem Meta'}]}
];

const filterState = {}; // field -> Set(valores selecionados)
const fullSets = {};    // field -> Set(todos os valores possíveis no dataset atual)

function uniqueSorted(arr, sortFn){
  const u = [...new Set(arr.filter(v=>v!==null&&v!==undefined&&v!==''))];
  return sortFn ? u.sort((a,b)=>sortFn(a)-sortFn(b)) : u.sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
}

function buildFilterBar(){
  const bar = document.getElementById('filterBar');
  bar.innerHTML = '';
  FILTER_DEFS.forEach(def => bar.appendChild(buildDropdown(def)));
  const clearBtn = document.createElement('button');
  clearBtn.className = 'dd-clear-all';
  clearBtn.textContent = 'Limpar Filtros';
  clearBtn.addEventListener('click', () => {
    FILTER_DEFS.forEach(def => { filterState[def.field] = new Set(fullSets[def.field]); });
    document.querySelectorAll('.dd-filter').forEach(closePanel);
    populateFilterOptions(); // re-renderiza checkboxes marcados
    refreshAll();
  });
  bar.appendChild(clearBtn);
}

function buildDropdown(def){
  const wrap = document.createElement('div');
  wrap.className = 'dd-filter';
  wrap.dataset.field = def.field;

  const btn = document.createElement('button');
  btn.className = 'dd-btn';
  btn.innerHTML = `<span class="dd-label-text">${def.label}</span><span class="dd-count"></span><span class="dd-caret">▾</span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = wrap.classList.contains('open');
    document.querySelectorAll('.dd-filter.open').forEach(closePanel);
    if(!isOpen) wrap.classList.add('open');
  });

  const panel = document.createElement('div');
  panel.className = 'dd-panel';

  const search = document.createElement('input');
  search.className = 'dd-search';
  search.placeholder = 'Pesquisar...';
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    panel.querySelectorAll('.dd-option').forEach(opt => {
      opt.style.display = opt.dataset.label.toLowerCase().includes(q) ? 'flex' : 'none';
    });
  });

  const allLabel = document.createElement('label');
  allLabel.className = 'dd-all';
  const allCheckbox = document.createElement('input');
  allCheckbox.type = 'checkbox';
  allLabel.appendChild(allCheckbox);
  allLabel.appendChild(document.createTextNode('Selecionar tudo'));
  allCheckbox.addEventListener('change', () => {
    if(allCheckbox.checked){ filterState[def.field] = new Set(fullSets[def.field]); }
    else { filterState[def.field] = new Set(); }
    renderDropdownOptions(panel, def);
    updateDropdownButton(wrap, def);
    refreshAll();
  });

  const optionsDiv = document.createElement('div');
  optionsDiv.className = 'dd-options';

  panel.appendChild(search);
  panel.appendChild(allLabel);
  panel.appendChild(optionsDiv);
  wrap.appendChild(btn);
  wrap.appendChild(panel);
  wrap._allCheckbox = allCheckbox;
  wrap._optionsDiv = optionsDiv;
  return wrap;
}

function closePanel(el){ el.classList.remove('open'); }
document.addEventListener('click', () => document.querySelectorAll('.dd-filter.open').forEach(closePanel));

function renderDropdownOptions(panel, def){
  const optionsDiv = panel.querySelector('.dd-options');
  const opts = def.dynamic
    ? uniqueSorted(DATA.map(d=>d[def.field]), def.sortFn).map(v=>({value:v,label:String(v)}))
    : def.options;
  optionsDiv.innerHTML = '';
  opts.forEach(o => {
    const lbl = document.createElement('label');
    lbl.className = 'dd-option';
    lbl.dataset.label = o.label;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = filterState[def.field].has(o.value);
    cb.addEventListener('change', () => {
      if(cb.checked) filterState[def.field].add(o.value);
      else filterState[def.field].delete(o.value);
      const wrap = panel.closest('.dd-filter');
      wrap._allCheckbox.checked = filterState[def.field].size === fullSets[def.field].size;
      updateDropdownButton(wrap, def);
      refreshAll();
    });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(o.label));
    optionsDiv.appendChild(lbl);
  });
}

function updateDropdownButton(wrap, def){
  const countEl = wrap.querySelector('.dd-count');
  const selected = filterState[def.field].size;
  const total = fullSets[def.field].size;
  countEl.textContent = (selected === total) ? '' : String(selected);
}

function populateFilterOptions(){
  FILTER_DEFS.forEach(def => {
    const opts = def.dynamic
      ? uniqueSorted(DATA.map(d=>d[def.field]), def.sortFn)
      : def.options.map(o=>o.value);
    fullSets[def.field] = new Set(opts);
    if(!filterState[def.field]) filterState[def.field] = new Set(opts);
    else {
      // mantém seleção válida; remove valores que não existem mais no dataset
      filterState[def.field] = new Set([...filterState[def.field]].filter(v => fullSets[def.field].has(v)));
      if(filterState[def.field].size===0) filterState[def.field] = new Set(opts);
    }
    const wrap = document.querySelector(`.dd-filter[data-field="${def.field}"]`);
    if(!wrap) return;
    const panel = wrap.querySelector('.dd-panel');
    renderDropdownOptions(panel, def);
    wrap._allCheckbox.checked = filterState[def.field].size === fullSets[def.field].size;
    updateDropdownButton(wrap, def);
  });
}

function applyFilters(){
  return DATA.filter(r => FILTER_DEFS.every(def => {
    const sel = filterState[def.field];
    const full = fullSets[def.field];
    if(!sel || !full || sel.size === full.size) return true; // sem filtro ativo
    return sel.has(r[def.field]);
  }));
}

/* ---------------------------------------------------------------------
   3. ABAS
   ------------------------------------------------------------------- */
function setupTabs(){
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
      renderActiveTab(btn.dataset.tab, applyFilters());
    });
  });
}

/* ---------------------------------------------------------------------
   4. FORMATAÇÃO
   ------------------------------------------------------------------- */
const fmtMoney = v => 'R$ ' + (v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtInt = v => (v||0).toLocaleString('pt-BR');
const fmtPct = v => (v===null||v===undefined||isNaN(v)) ? '—' : v.toFixed(1).replace('.',',')+'%';
const fmtROI = v => (v===null||v===undefined||isNaN(v)) ? '—' : v.toFixed(2).replace('.',',')+'x';

/* ---------------------------------------------------------------------
   5. AGREGAÇÕES GENÉRICAS
   ------------------------------------------------------------------- */
function avg(arr){ const v = arr.filter(x=>x!==null&&x!==undefined&&!isNaN(x)); return v.length ? v.reduce((s,x)=>s+x,0)/v.length : null; }
function sum(arr){ return arr.reduce((s,x)=>s+(x||0),0); }

function groupBy(rows, keyFn){
  const map = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    if(k===null||k===undefined||k==='') return;
    if(!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return map;
}

function aggregateGroup(rows){
  const comMeta = rows.filter(r=>typeof r.metaCampanha==='number' && r.metaCampanha>0);
  return {
    count: rows.length,
    pctMetasAtingidas: rows.length ? (rows.filter(r=>r.metaAtingida==='Sim').length/rows.length)*100 : 0,
    crescimentoMedio: avg(rows.map(r=>r.growthPct)),
    investimento: sum(rows.map(r=>r.custoFinal||r.custoPrevisto)),
    custoMedio: avg(rows.map(r=>r.custoFinal||r.custoPrevisto)),
    roiMedio: avg(rows.map(r=>r.roi)),
    realizadoTotal: sum(rows.map(r=>r.realizado))
  };
}

/* ---------------------------------------------------------------------
   6. CHART.JS — CONFIG BASE
   ------------------------------------------------------------------- */
let charts = {};
function destroyChart(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }
const baseGridColor = '#E3E9EF';
if(typeof Chart !== 'undefined'){
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color = '#5C6B79';
}

/* =========================================================================
   ABA: EXECUTIVO
   ========================================================================= */
function renderExecutivo(rows){
  const investimentoTotal = sum(rows.map(r=>r.custoFinal||r.custoPrevisto));
  const comROI = rows.filter(r=>r.roi!==null);
  const roiGeral = sum(comROI.map(r=>r.realizado)) / (sum(comROI.map(r=>r.custoFinal)) || 1);
  const metasPct = rows.length ? (rows.filter(r=>r.metaAtingida==='Sim').length/rows.length)*100 : 0;
  const crescimentoMedio = avg(rows.map(r=>r.growthPct));
  const ativas = rows.filter(r=>r.status==='EM ANDAMENTO').length;
  const finalizadas = rows.filter(r=>r.status==='CONCLUÍDA').length;

  const porMarca = [...groupBy(rows, r=>r.fabrica)].map(([k,v])=>({k, ...aggregateGroup(v)})).filter(m=>m.count>=2);
  const melhorMarca = porMarca.sort((a,b)=>b.pctMetasAtingidas-a.pctMetasAtingidas)[0];
  const porCliente = [...groupBy(rows, r=>r.cliente)].map(([k,v])=>({k, ...aggregateGroup(v)})).filter(c=>c.count>=1);
  const melhorCliente = porCliente.sort((a,b)=>(b.crescimentoMedio||-999)-(a.crescimentoMedio||-999))[0];

  const cards = [
    {label:'Investimento Total', value:fmtMoney(investimentoTotal), accent:'blue'},
    {label:'ROI Geral', value:fmtROI(roiGeral), accent: roiGeral>=1?'good':'bad'},
    {label:'Metas Atingidas %', value:fmtPct(metasPct), accent:'royal'},
    {label:'Crescimento Médio %', value:fmtPct(crescimentoMedio), accent: (crescimentoMedio||0)>=0?'good':'bad'},
    {label:'Campanhas Ativas', value:fmtInt(ativas), accent:'sky'},
    {label:'Campanhas Finalizadas', value:fmtInt(finalizadas), accent:'tiffany'},
    {label:'Melhor Marca', value: melhorMarca ? melhorMarca.k : '—', accent:'good', foot: melhorMarca ? fmtPct(melhorMarca.pctMetasAtingidas)+' de metas atingidas' : ''},
    {label:'Melhor Cliente', value: melhorCliente ? melhorCliente.k : '—', accent:'good', foot: melhorCliente ? fmtPct(melhorCliente.crescimentoMedio)+' de crescimento' : ''}
  ];
  document.getElementById('kpiGridExec').innerHTML = cards.map(c => `
    <div class="kpi-card accent-${c.accent}">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      ${c.foot ? `<div class="kpi-foot">${c.foot}</div>` : ''}
    </div>`).join('');

  // Ranking de marcas (meta vs realizado vs %)
  destroyChart('marcasExec');
  const metaMap = new Map(), realMap = new Map();
  rows.forEach(r => {
    metaMap.set(r.fabrica, (metaMap.get(r.fabrica)||0) + (typeof r.metaCampanha==='number'?r.metaCampanha:0));
    realMap.set(r.fabrica, (realMap.get(r.fabrica)||0) + r.realizado);
  });
  const labelsM = [...realMap.keys()].sort((a,b)=>realMap.get(b)-realMap.get(a)).slice(0,10);
  charts.marcasExec = new Chart(document.getElementById('chartMarcasExec'), {
    type:'bar',
    data:{labels:labelsM, datasets:[
      {type:'bar', label:'Meta', data:labelsM.map(l=>metaMap.get(l)||0), backgroundColor:COLORS.grafite, borderRadius:4},
      {type:'bar', label:'Resultado', data:labelsM.map(l=>realMap.get(l)||0), backgroundColor:COLORS.cobalto, borderRadius:4}
    ]},
    options:{responsive:true, maintainAspectRatio:false, scales:{y:{beginAtZero:true, grid:{color:baseGridColor}}, x:{grid:{display:false}}}, plugins:{legend:{position:'bottom'}}}
  });

  // Evolução mensal
  destroyChart('evolucao');
  const metaMes = new Map(), realMes = new Map();
  rows.forEach(r => {
    metaMes.set(r.mes, (metaMes.get(r.mes)||0) + (typeof r.metaCampanha==='number'?r.metaCampanha:0));
    realMes.set(r.mes, (realMes.get(r.mes)||0) + r.realizado);
  });
  const labelsMes = [...new Set([...metaMes.keys(), ...realMes.keys()])].sort((a,b)=>mesSortKey(a)-mesSortKey(b));
  charts.evolucao = new Chart(document.getElementById('chartEvolucao'), {
    type:'line',
    data:{labels:labelsMes, datasets:[
      {label:'Meta', data:labelsMes.map(l=>metaMes.get(l)||0), borderColor:COLORS.grafite, backgroundColor:'rgba(182,184,186,.15)', fill:true, tension:.35},
      {label:'Realizado', data:labelsMes.map(l=>realMes.get(l)||0), borderColor:COLORS.cobalto, backgroundColor:'rgba(0,94,150,.15)', fill:true, tension:.35}
    ]},
    options:{responsive:true, maintainAspectRatio:false, scales:{y:{beginAtZero:true, grid:{color:baseGridColor}}, x:{grid:{display:false}}}, plugins:{legend:{position:'bottom'}}}
  });

  // Faixas
  destroyChart('faixaExec');
  const order = ['Crítico','Atenção','Meta Atingida','Super Performance','Sem Meta'];
  const colorFor = {'Crítico':COLORS.critico,'Atenção':COLORS.atencao,'Meta Atingida':COLORS.tiffany,'Super Performance':COLORS.royal,'Sem Meta':COLORS.grafite};
  const faixaMap = new Map();
  rows.forEach(r => faixaMap.set(r.faixaPerformance, (faixaMap.get(r.faixaPerformance)||0)+1));
  const labelsF = order.filter(l=>faixaMap.has(l));
  charts.faixaExec = new Chart(document.getElementById('chartFaixaExec'), {
    type:'doughnut',
    data:{labels:labelsF, datasets:[{data:labelsF.map(l=>faixaMap.get(l)), backgroundColor:labelsF.map(l=>colorFor[l]), borderWidth:2, borderColor:'#fff'}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom', labels:{boxWidth:12}}}}
  });

  // Tipo de campanha
  destroyChart('tipoExec');
  const tipoMap = new Map();
  rows.forEach(r => tipoMap.set(r.categoriaCampanha, (tipoMap.get(r.categoriaCampanha)||0)+1));
  const labelsT = [...tipoMap.keys()];
  charts.tipoExec = new Chart(document.getElementById('chartTipoExec'), {
    type:'doughnut',
    data:{labels:labelsT, datasets:[{data:labelsT.map(l=>tipoMap.get(l)), backgroundColor:[COLORS.cobalto,COLORS.royal,COLORS.tiffany,COLORS.ceu,COLORS.atencao,COLORS.grafite], borderWidth:2, borderColor:'#fff'}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom', labels:{boxWidth:12}}}}
  });

  renderMainTable(rows);
}

let mainTable = null;
function badgeFaixa(f){ const map={'Crítico':'critico','Atenção':'atencao','Meta Atingida':'atingida','Super Performance':'super','Sem Meta':'sem-meta'}; return `<span class="badge ${map[f]||'sem-meta'}">${f}</span>`; }
function badgeSimNao(v){ return `<span class="badge ${v==='Sim'?'sim':'nao'}">${v||'—'}</span>`; }

function renderMainTable(rows){
  const body = rows.map(r => [
    r.fabrica||'', r.cliente||'', r.cidade||'', r.uf||'', r.mes||'', r.categoriaCampanha||'', r.premiacao||'',
    r.status||'', (typeof r.metaCampanha==='number') ? fmtInt(r.metaCampanha) : (r.semMeta?'Sem Meta':'—'),
    fmtInt(r.realizado), fmtPct(r.pctAtingimento), badgeFaixa(r.faixaPerformance), badgeSimNao(r.metaAtingida), fmtMoney(r.custoFinal||r.custoPrevisto||0)
  ]);
  if(mainTable){ mainTable.clear(); mainTable.rows.add(body); mainTable.draw(); }
  else {
    mainTable = $('#campaignsTable').DataTable({
      data:body, columns:Array.from({length:14},()=>({})), pageLength:10, lengthMenu:[10,25,50,100],
      language:{search:'Pesquisar:', lengthMenu:'Mostrar _MENU_ registros', info:'Mostrando _START_–_END_ de _TOTAL_', infoEmpty:'Sem registros', paginate:{previous:'‹',next:'›'}, zeroRecords:'Nenhuma campanha encontrada'},
      order:[[10,'desc']]
    });
  }
}

/* =========================================================================
   ABA: MARCAS
   ========================================================================= */
let marcasTable = null;
function renderMarcas(rows){
  const grouped = [...groupBy(rows, r=>r.fabrica)].map(([k,v])=>({marca:k, ...aggregateGroup(v)}));

  function renderRankingChart(){
    const metric = document.getElementById('marcaMetricSelect').value;
    const metricMap = {pctMetas:'pctMetasAtingidas', crescimento:'crescimentoMedio', investimento:'investimento', roi:'roiMedio'};
    const field = metricMap[metric];
    const sorted = [...grouped].filter(g=>g[field]!==null && !isNaN(g[field])).sort((a,b)=>b[field]-a[field]).slice(0,15);
    destroyChart('marcaRanking');
    const labelMetric = {pctMetas:'% Metas Atingidas', crescimento:'Crescimento Médio (%)', investimento:'Investimento (R$)', roi:'ROI Médio (x)'}[metric];
    charts.marcaRanking = new Chart(document.getElementById('chartMarcaRanking'), {
      type:'bar',
      data:{labels:sorted.map(s=>s.marca), datasets:[{label:labelMetric, data:sorted.map(s=>s[field]), backgroundColor:COLORS.cobalto, borderRadius:4}]},
      options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{x:{beginAtZero:true, grid:{color:baseGridColor}}, y:{grid:{display:false}}}, plugins:{legend:{display:false}}}
    });
  }
  document.getElementById('marcaMetricSelect').onchange = renderRankingChart;
  renderRankingChart();

  const body = grouped.sort((a,b)=>b.count-a.count).map(g => [
    g.marca, fmtInt(g.count), fmtPct(g.pctMetasAtingidas), fmtPct(g.crescimentoMedio), fmtMoney(g.investimento), fmtROI(g.roiMedio)
  ]);
  if(marcasTable){ marcasTable.clear(); marcasTable.rows.add(body); marcasTable.draw(); }
  else {
    marcasTable = $('#marcasTable').DataTable({
      data:body, columns:Array.from({length:6},()=>({})), pageLength:10,
      language:{search:'Pesquisar:', lengthMenu:'Mostrar _MENU_', info:'_START_–_END_ de _TOTAL_', paginate:{previous:'‹',next:'›'}}
    });
  }
}

/* =========================================================================
   ABA: CLIENTES
   ========================================================================= */
function renderClientes(rows){
  const grouped = [...groupBy(rows, r=>r.cliente)].map(([k,v])=>({cliente:k, ...aggregateGroup(v)}));

  destroyChart('clienteCrescimento');
  const topCresc = [...grouped].filter(g=>g.crescimentoMedio!==null).sort((a,b)=>b.crescimentoMedio-a.crescimentoMedio).slice(0,10);
  charts.clienteCrescimento = new Chart(document.getElementById('chartClienteCrescimento'), {
    type:'bar',
    data:{labels:topCresc.map(c=>c.cliente), datasets:[{label:'Crescimento (%)', data:topCresc.map(c=>c.crescimentoMedio), backgroundColor:COLORS.good, borderRadius:4}]},
    options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{x:{grid:{color:baseGridColor}}, y:{grid:{display:false}}}, plugins:{legend:{display:false}}}
  });

  destroyChart('clienteQtd');
  const topQtd = [...grouped].sort((a,b)=>b.count-a.count).slice(0,10);
  charts.clienteQtd = new Chart(document.getElementById('chartClienteQtd'), {
    type:'bar',
    data:{labels:topQtd.map(c=>c.cliente), datasets:[{label:'Campanhas', data:topQtd.map(c=>c.count), backgroundColor:COLORS.royal, borderRadius:4}]},
    options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{x:{beginAtZero:true, grid:{color:baseGridColor}}, y:{grid:{display:false}}}, plugins:{legend:{display:false}}}
  });

  destroyChart('clienteROI');
  const topROI = [...grouped].filter(g=>g.roiMedio!==null).sort((a,b)=>b.roiMedio-a.roiMedio).slice(0,10);
  charts.clienteROI = new Chart(document.getElementById('chartClienteROI'), {
    type:'bar',
    data:{labels:topROI.map(c=>c.cliente), datasets:[{label:'ROI Médio (x)', data:topROI.map(c=>c.roiMedio), backgroundColor:COLORS.tiffany, borderRadius:4}]},
    options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{x:{beginAtZero:true, grid:{color:baseGridColor}}, y:{grid:{display:false}}}, plugins:{legend:{display:false}}}
  });
}

/* =========================================================================
   ABA: GEOGRÁFICO
   ========================================================================= */
function renderGeo(rows){
  const byUF = [...groupBy(rows, r=>r.uf)].map(([k,v])=>({uf:k, ...aggregateGroup(v)}));

  function renderHeatGrid(){
    const metric = document.getElementById('geoMetricSelect').value;
    const field = {vendas:'realizadoTotal', metaPct:'pctMetasAtingidas', crescimento:'crescimentoMedio'}[metric];
    const vals = byUF.map(u=>u[field]).filter(v=>v!==null && !isNaN(v));
    const max = vals.length ? Math.max(...vals) : 1;
    const min = vals.length ? Math.min(...vals) : 0;
    const grid = document.getElementById('geoMapGrid');
    grid.innerHTML = '';
    for(let row=0; row<4; row++){
      for(let col=0; col<4; col++){
        const uf = Object.keys(UF_GRID_POS).find(k => UF_GRID_POS[k][0]===row && UF_GRID_POS[k][1]===col);
        const tile = document.createElement('div');
        if(!uf){ tile.className='geo-tile empty'; grid.appendChild(tile); continue; }
        const data = byUF.find(u=>u.uf===uf);
        const val = data ? data[field] : null;
        const norm = (val!==null && max>min) ? (val-min)/(max-min) : 0.15;
        const lightness = 75 - norm*45; // mais escuro = maior valor
        tile.className = 'geo-tile';
        tile.style.background = `hsl(202, 75%, ${lightness}%)`;
        const valLabel = field==='pctMetasAtingidas' ? fmtPct(val) : (field==='crescimentoMedio' ? fmtPct(val) : fmtInt(val));
        tile.innerHTML = `<span class="geo-uf">${uf}</span><span class="geo-val">${data ? valLabel : '—'}</span>`;
        grid.appendChild(tile);
      }
    }
  }
  document.getElementById('geoMetricSelect').onchange = renderHeatGrid;
  renderHeatGrid();

  destroyChart('vendasUF');
  const sortedVendas = [...byUF].sort((a,b)=>b.realizadoTotal-a.realizadoTotal);
  charts.vendasUF = new Chart(document.getElementById('chartVendasUF'), {
    type:'bar',
    data:{labels:sortedVendas.map(u=>u.uf), datasets:[{label:'Vendas (Realizado)', data:sortedVendas.map(u=>u.realizadoTotal), backgroundColor:COLORS.cobalto, borderRadius:4}]},
    options:{responsive:true, maintainAspectRatio:false, scales:{y:{beginAtZero:true, grid:{color:baseGridColor}}, x:{grid:{display:false}}}, plugins:{legend:{display:false}}}
  });

  destroyChart('metaUF');
  const sortedMeta = [...byUF].sort((a,b)=>b.pctMetasAtingidas-a.pctMetasAtingidas);
  charts.metaUF = new Chart(document.getElementById('chartMetaUF'), {
    type:'bar',
    data:{labels:sortedMeta.map(u=>u.uf), datasets:[{label:'% Metas Atingidas', data:sortedMeta.map(u=>u.pctMetasAtingidas), backgroundColor:COLORS.tiffany, borderRadius:4}]},
    options:{responsive:true, maintainAspectRatio:false, scales:{y:{beginAtZero:true, max:100, grid:{color:baseGridColor}, ticks:{callback:v=>v+'%'}}, x:{grid:{display:false}}}, plugins:{legend:{display:false}}}
  });

  destroyChart('crescimentoRegiao');
  const byRegiao = [...groupBy(rows, r=>r.regiao)].map(([k,v])=>({regiao:k, ...aggregateGroup(v)})).sort((a,b)=>(b.crescimentoMedio||-999)-(a.crescimentoMedio||-999));
  charts.crescimentoRegiao = new Chart(document.getElementById('chartCrescimentoRegiao'), {
    type:'bar',
    data:{labels:byRegiao.map(r=>r.regiao), datasets:[{label:'Crescimento Médio (%)', data:byRegiao.map(r=>r.crescimentoMedio), backgroundColor:COLORS.royal, borderRadius:4}]},
    options:{responsive:true, maintainAspectRatio:false, scales:{y:{grid:{color:baseGridColor}}, x:{grid:{display:false}}}, plugins:{legend:{display:false}}}
  });
}

/* =========================================================================
   ABA: ROI
   ========================================================================= */
function renderROI(rows){
  const comROI = rows.filter(r=>r.roi!==null);
  const investimentoTotal = sum(rows.map(r=>r.custoFinal||r.custoPrevisto));
  const roiGeral = sum(comROI.map(r=>r.realizado)) / (sum(comROI.map(r=>r.custoFinal)) || 1);
  const rentaveis = comROI.filter(r=>r.roi>=1).length;
  const comPrejuizo = comROI.filter(r=>r.roi<1).length;

  document.getElementById('kpiGridROI').innerHTML = [
    {label:'Investimento Total', value:fmtMoney(investimentoTotal), accent:'blue'},
    {label:'ROI Geral', value:fmtROI(roiGeral), accent: roiGeral>=1?'good':'bad'},
    {label:'Campanhas Rentáveis (ROI ≥ 1x)', value:fmtInt(rentaveis), accent:'good'},
    {label:'Campanhas com Prejuízo (ROI < 1x)', value:fmtInt(comPrejuizo), accent:'bad'}
  ].map(c=>`<div class="kpi-card accent-${c.accent}"><div class="kpi-label">${c.label}</div><div class="kpi-value">${c.value}</div></div>`).join('');

  destroyChart('roiTop');
  const top = [...comROI].sort((a,b)=>b.roi-a.roi).slice(0,10);
  charts.roiTop = new Chart(document.getElementById('chartROITop'), {
    type:'bar',
    data:{labels:top.map(r=>`${r.cliente} (${r.fabrica})`), datasets:[{label:'ROI (x)', data:top.map(r=>r.roi), backgroundColor:COLORS.good, borderRadius:4}]},
    options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{x:{beginAtZero:true, grid:{color:baseGridColor}}, y:{grid:{display:false}}}, plugins:{legend:{display:false}}}
  });

  destroyChart('roiBottom');
  const bottom = [...comROI].sort((a,b)=>a.roi-b.roi).slice(0,10);
  charts.roiBottom = new Chart(document.getElementById('chartROIBottom'), {
    type:'bar',
    data:{labels:bottom.map(r=>`${r.cliente} (${r.fabrica})`), datasets:[{label:'ROI (x)', data:bottom.map(r=>r.roi), backgroundColor:COLORS.critico, borderRadius:4}]},
    options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{x:{beginAtZero:true, grid:{color:baseGridColor}}, y:{grid:{display:false}}}, plugins:{legend:{display:false}}}
  });

  destroyChart('roiFabricante');
  const porFabricante = [...groupBy(rows, r=>r.fabrica)].map(([k,v])=>({k, roiMedio:avg(v.map(r=>r.roi))})).filter(f=>f.roiMedio!==null).sort((a,b)=>b.roiMedio-a.roiMedio);
  charts.roiFabricante = new Chart(document.getElementById('chartROIFabricante'), {
    type:'bar',
    data:{labels:porFabricante.map(f=>f.k), datasets:[{label:'ROI Médio (x)', data:porFabricante.map(f=>f.roiMedio), backgroundColor:COLORS.royal, borderRadius:4}]},
    options:{responsive:true, maintainAspectRatio:false, scales:{y:{beginAtZero:true, grid:{color:baseGridColor}}, x:{grid:{display:false}}}, plugins:{legend:{display:false}}}
  });
}

/* =========================================================================
   ABA: EFICIÊNCIA
   ========================================================================= */
let eficienciaTable = null;
function renderEficiencia(rows){
  const ordem = ['Cashback','Brindes','Bonificação','Pontuação','Viagem','Vale-compras','Outros'];
  const grouped = [...groupBy(rows, r=>r.categoriaCampanha)].map(([k,v])=>({tipo:k, ...aggregateGroup(v)}));
  grouped.sort((a,b)=>ordem.indexOf(a.tipo)-ordem.indexOf(b.tipo));

  destroyChart('eficiencia');
  charts.eficiencia = new Chart(document.getElementById('chartEficiencia'), {
    data:{
      labels:grouped.map(g=>g.tipo),
      datasets:[
        {type:'bar', label:'% Metas Atingidas', data:grouped.map(g=>g.pctMetasAtingidas), backgroundColor:COLORS.cobalto, borderRadius:4, yAxisID:'y'},
        {type:'bar', label:'Crescimento Médio (%)', data:grouped.map(g=>g.crescimentoMedio), backgroundColor:COLORS.tiffany, borderRadius:4, yAxisID:'y'},
        {type:'line', label:'Custo Médio (R$)', data:grouped.map(g=>g.custoMedio), borderColor:COLORS.atencao, backgroundColor:COLORS.atencao, yAxisID:'y1', tension:.3, pointRadius:4}
      ]
    },
    options:{
      type:'bar', responsive:true, maintainAspectRatio:false,
      scales:{y:{beginAtZero:true, grid:{color:baseGridColor}}, y1:{beginAtZero:true, position:'right', grid:{display:false}, ticks:{callback:v=>'R$ '+v}}, x:{grid:{display:false}}},
      plugins:{legend:{position:'bottom'}}
    }
  });

  const body = grouped.map(g => [g.tipo, fmtInt(g.count), fmtPct(g.pctMetasAtingidas), fmtPct(g.crescimentoMedio), fmtMoney(g.custoMedio)]);
  if(eficienciaTable){ eficienciaTable.clear(); eficienciaTable.rows.add(body); eficienciaTable.draw(); }
  else {
    eficienciaTable = $('#eficienciaTable').DataTable({
      data:body, columns:Array.from({length:5},()=>({})), paging:false, searching:false, info:false,
      language:{}
    });
  }
}

/* =========================================================================
   ABA: ALERTAS
   ========================================================================= */
function renderAlertas(rows){
  const defs = [
    {key:'alertaVencidaSemFechamento', icon:'⏰', title:'Campanhas Vencidas sem Fechamento', desc:r=>`Encerrou em ${r.dataFim||'—'} e ainda está "${r.status}"`},
    {key:'alertaSemPagamento', icon:'💸', title:'Campanhas sem Pagamento Registrado', desc:r=>`Meta atingida, mas sem data de pagamento`},
    {key:'alertaCustoAcima', icon:'📈', title:'Campanhas com Custo Acima do Previsto', desc:r=>`Previsto ${fmtMoney(r.custoPrevisto)} → Final ${fmtMoney(r.custoFinal)}`},
    {key:'alertaCrescimentoNegativo', icon:'📉', title:'Campanhas com Crescimento Negativo', desc:r=>`Crescimento de ${fmtPct(r.growthPct)} vs. média antes da campanha`}
  ];

  let totalAlertas = 0;
  const grid = document.getElementById('alertGrid');
  grid.innerHTML = defs.map(def => {
    const list = rows.filter(r=>r[def.key]);
    totalAlertas += list.length;
    const items = list.slice(0,30).map(r => `<div class="alert-item"><span><b>${r.fabrica}</b> · ${r.cliente}</span><span>${def.desc(r)}</span></div>`).join('');
    return `
      <div class="alert-card ${list.length===0?'ok':''}">
        <div class="alert-head">
          <span class="alert-title">${def.icon} ${def.title}</span>
          <span class="alert-count">${list.length}</span>
        </div>
        <div class="alert-list">${items || '<div class="alert-empty">Nenhuma ocorrência 🎉</div>'}</div>
      </div>`;
  }).join('');

  const badge = document.getElementById('alertCountBadge');
  badge.textContent = totalAlertas > 0 ? totalAlertas : '';
}

/* ---------------------------------------------------------------------
   7. ORQUESTRAÇÃO
   ------------------------------------------------------------------- */
function renderActiveTab(tab, rows){
  switch(tab){
    case 'executivo': renderExecutivo(rows); break;
    case 'marcas': renderMarcas(rows); break;
    case 'clientes': renderClientes(rows); break;
    case 'geo': renderGeo(rows); break;
    case 'roi': renderROI(rows); break;
    case 'eficiencia': renderEficiencia(rows); break;
    case 'alertas': renderAlertas(rows); break;
  }
}

function refreshAll(){
  const rows = applyFilters();
  const activeTab = document.querySelector('.tab-btn.active');
  // Sempre recalcula alertas (para o badge no menu) e a aba ativa
  renderAlertas(rows);
  if(activeTab) renderActiveTab(activeTab.dataset.tab, rows);
}

function setLastUpdate(){
  const el = document.getElementById('lastUpdate');
  const now = new Date();
  el.textContent = 'Atualizado em ' + now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}

/* ---------------------------------------------------------------------
   8. IMPORTAÇÃO DE PLANILHA
   ------------------------------------------------------------------- */
document.getElementById('fileInput').addEventListener('change', function(e){
  const file = e.target.files[0];
  if(!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if(ext === 'csv'){
    Papa.parse(file, { complete: res => {
      const rows = res.data.filter(r => r.length && r.some(c=>c!==''));
      ingestSheet(rows[0], rows.slice(1));
    }});
  } else {
    const reader = new FileReader();
    reader.onload = ev => {
      const wb = XLSX.read(ev.target.result, {type:'binary', cellDates:true});
      let best = null, bestScore = -1;
      wb.SheetNames.forEach(name => {
        const json = XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, raw:true});
        for(let i=0;i<Math.min(json.length,10);i++){
          const row = json[i]; if(!row) continue;
          const score = row.filter(c => HEADER_MAP[normalizeHeader(c)]).length;
          if(score > bestScore){ bestScore = score; best = {rows:json, headerRow:i}; }
        }
      });
      if(best && bestScore >= 3){
        ingestSheet(best.rows[best.headerRow], best.rows.slice(best.headerRow+1));
      } else {
        alert('Não foi possível identificar automaticamente as colunas da planilha.');
      }
    };
    reader.readAsBinaryString(file);
  }
});

function ingestSheet(headers, rows){
  const parsed = rows.map(r => rowFromImported(headers, r)).filter(Boolean);
  if(!parsed.length){ alert('Nenhuma campanha válida foi encontrada na planilha importada.'); return; }
  DATA = parsed;
  populateFilterOptions();
  setLastUpdate();
  refreshAll();
}

/* ---------------------------------------------------------------------
   9. EXPORTAÇÃO
   ------------------------------------------------------------------- */
document.getElementById('exportExcel').addEventListener('click', () => {
  const rows = applyFilters();
  const sheetData = rows.map(r => ({
    'Marca':r.fabrica,'Cliente':r.cliente,'Cidade':r.cidade,'UF':r.uf,'Mês':r.mes,'Tipo Campanha':r.categoriaCampanha,
    'Premiação':r.premiacao,'Status':r.status,'Meta':(typeof r.metaCampanha==='number')?r.metaCampanha:(r.semMeta?'Sem Meta':''),
    'Realizado':r.realizado,'% Atingimento':r.pctAtingimento,'Faixa':r.faixaPerformance,'Meta Atingida':r.metaAtingida,
    'Crescimento %':r.growthPct,'ROI':r.roi,'Custo Previsto':r.custoPrevisto,'Custo Final':r.custoFinal
  }));
  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Campanhas RBR');
  XLSX.writeFile(wb, 'RBR_Campanhas_Filtradas.xlsx');
});

document.getElementById('exportPDF').addEventListener('click', () => {
  const rows = applyFilters();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'landscape'});
  doc.setFontSize(16); doc.setTextColor(0,94,150);
  doc.text('RBR — Painel Executivo de Campanhas de Venda 2026', 14, 16);
  doc.setFontSize(10); doc.setTextColor(90,100,110);
  doc.text(`Total de campanhas: ${rows.length}`, 14, 23);
  doc.autoTable({
    startY:28,
    head:[['Marca','Cliente','UF','Mês','Status','Meta','Realizado','% Atingimento','ROI','Faixa']],
    body: rows.map(r => [r.fabrica, r.cliente, r.uf, r.mes, r.status,
      (typeof r.metaCampanha==='number')?fmtInt(r.metaCampanha):(r.semMeta?'Sem Meta':'—'),
      fmtInt(r.realizado), fmtPct(r.pctAtingimento), fmtROI(r.roi), r.faixaPerformance]),
    styles:{fontSize:7}, headStyles:{fillColor:[19,63,104]}
  });
  doc.save('RBR_Campanhas_Filtradas.pdf');
});

/* ---------------------------------------------------------------------
   10. BOOT
   ------------------------------------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  try{
    loadEmbeddedData();
    buildFilterBar();
    populateFilterOptions();
    setupTabs();
    setLastUpdate();
    refreshAll();
  } catch(err){
    console.error('Erro ao iniciar o painel RBR:', err);
    const loaderText = document.querySelector('#loader p');
    if(loaderText) loaderText.textContent = 'Ocorreu um erro ao carregar o painel. Verifique a console (F12) para detalhes.';
  } finally {
    setTimeout(() => document.getElementById('loader').classList.add('hidden'), 600);
  }
});
