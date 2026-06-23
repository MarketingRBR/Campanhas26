/* =========================================================================
   RBR — PAINEL EXECUTIVO DE CAMPANHAS DE VENDA
   Motor de dados, regras de negócio, filtros, KPIs, gráficos e tabela.
   ========================================================================= */

const COLORS = {
  cobalto: '#005E96',
  indigo: '#133F68',
  royal: '#0D96D4',
  ceu: '#44C8F5',
  grafite: '#B6B8BA',
  tiffany: '#19B2AC',
  critico: '#C0392B',
  atencao: '#E0962B',
  good: '#1f9d72'
};

let DATA = []; // dataset ativo (normalizado)

/* ---------------------------------------------------------------------
   1. NORMALIZAÇÃO / DETECÇÃO AUTOMÁTICA DE COLUNAS
   Usado tanto para os dados embutidos quanto para planilhas importadas.
   ------------------------------------------------------------------- */
const HEADER_MAP = {
  'FÁBRICA': 'fabrica', 'FABRICA': 'fabrica', 'MARCA': 'fabrica',
  'CLIENTE': 'cliente',
  'CIDADE': 'cidade',
  'UF': 'uf', 'ESTADO': 'uf',
  'MÊS COMPETÊNCIA': 'mes', 'MES COMPETENCIA': 'mes', 'MÊS': 'mes',
  'TIPO DE CAMPANHA': 'tipoCampanha',
  'MECÂNICA DA CAMPANHA': 'mecanica', 'MECANICA DA CAMPANHA': 'mecanica',
  'PREMIAÇÃO': 'premiacao', 'PREMIACAO': 'premiacao',
  'STATUS DA CAMPANHA': 'status',
  'CUSTO PREVISTO': 'custoPrevisto',
  'CUSTO FINAL': 'custoFinal',
  'INVESTIMENTO': 'investimentoOrigem',
  'META': 'metaTipo',
  'MÉDIA ANTES DA CAMPANHA': 'mediaAntes', 'MEDIA ANTES DA CAMPANHA': 'mediaAntes',
  'META CAMPANHA': 'metaCampanha',
  'REALIZADO DURANTE A CAMPANHA': 'realizado',
  'DATA DE ÍNICIO': 'dataInicio', 'DATA DE INICIO': 'dataInicio',
  'DATA DE TÉRMINO': 'dataFim', 'DATA DE TERMINO': 'dataFim',
  'DATA DE PAGAMENTO': 'dataPagamento',
  'RESPONSÁVEL DO CLIENTE POR AUTORIZAR A CAMPANHA': 'responsavel',
  'META ATINGIDA': 'metaAtingida'
};

const UF_REGION = {
  PE:'Nordeste', BA:'Nordeste', PB:'Nordeste', RN:'Nordeste', AL:'Nordeste',
  SE:'Nordeste', PI:'Nordeste', CE:'Nordeste', MA:'Nordeste',
  SP:'Sudeste', RJ:'Sudeste', MG:'Sudeste', ES:'Sudeste',
  PR:'Sul', SC:'Sul', RS:'Sul',
  GO:'Centro-Oeste', MT:'Centro-Oeste', MS:'Centro-Oeste', DF:'Centro-Oeste',
  AM:'Norte', PA:'Norte', AC:'Norte', RO:'Norte', RR:'Norte', AP:'Norte', TO:'Norte'
};

function normalizeHeader(h){
  return String(h||'').trim().toUpperCase().replace(/\s+/g,' ');
}

function classifyPayment(premiacao){
  const p = String(premiacao||'').toUpperCase();
  if(p.includes('DINHEIRO')) return 'Em Dinheiro';
  if(p.includes('CARTÃO')||p.includes('CARTAO')||p.includes('VALE')||p.includes('CHOCOLATE')||p.includes('CERVEJA')||p.includes('OVOS')||p.includes('VIAGEM')) return 'Bonificação';
  if(p.includes('BRINDE')||p.includes('CAMISA')||p.includes('KIT')) return 'Em Peça';
  return 'Outros';
}

function classifyFaixa(pct){
  if(pct === null || pct === undefined || isNaN(pct)) return 'Sem Meta';
  if(pct < 80) return 'Crítico';
  if(pct < 100) return 'Atenção';
  if(pct < 120) return 'Meta Atingida';
  return 'Super Performance';
}

function mesToAno(mes){
  if(!mes) return null;
  const m = String(mes).match(/(\d{2,4})$/);
  if(!m) return null;
  let y = m[1];
  if(y.length === 2) y = '20'+y;
  return y;
}

const MES_ORDER = {'jan':1,'fev':2,'mar':3,'abr':4,'mai':5,'jun':6,'jul':7,'ago':8,'set':9,'out':10,'nov':11,'dez':12};
function mesSortKey(mes){
  if(!mes) return 9999;
  const parts = String(mes).toLowerCase().split('-');
  const mm = MES_ORDER[parts[0]] || 0;
  let yy = parseInt(parts[1]||'0',10);
  if(yy < 100) yy += 2000;
  return yy*100+mm;
}

// Normaliza um registro já no formato interno (dados embutidos) -- garante campos derivados
function finalizeRecord(r){
  r.uf = (r.uf||'').trim().toUpperCase();
  r.regiao = r.regiao || UF_REGION[r.uf] || 'Outras';
  r.tipoPagamento = r.tipoPagamento || classifyPayment(r.premiacao);
  r.ano = mesToAno(r.mes);
  const metaNum = (typeof r.metaCampanha === 'number') ? r.metaCampanha : null;
  r.pctAtingimento = (metaNum && metaNum > 0) ? Math.round((r.realizado/metaNum)*10000)/100 : (r.pctAtingimento ?? null);
  r.faixaPerformance = r.faixaPerformance || classifyFaixa(r.pctAtingimento);
  return r;
}

// Converte uma linha crua de planilha importada (array de células + headers) para o formato interno
function rowFromImported(headers, row){
  const rec = {};
  headers.forEach((h, i) => {
    const key = HEADER_MAP[normalizeHeader(h)];
    if(key) rec[key] = row[i];
  });
  if(!rec.fabrica) return null;
  rec.custoPrevisto = parseFloat(rec.custoPrevisto)||0;
  rec.custoFinal = parseFloat(rec.custoFinal)||0;
  let metaRaw = rec.metaCampanha;
  rec.semMeta = (typeof metaRaw === 'string' && metaRaw.toUpperCase().includes('SEM META'));
  rec.metaCampanha = (typeof metaRaw === 'number') ? metaRaw : (parseFloat(metaRaw) || null);
  rec.realizado = parseFloat(rec.realizado) || 0;
  rec.mediaAntes = parseFloat(rec.mediaAntes) || null;
  return finalizeRecord(rec);
}

function loadEmbeddedData(){
  DATA = (RBR_RAW_DATA||[]).map(r => finalizeRecord({...r}));
}

/* ---------------------------------------------------------------------
   2. ESTADO DE FILTROS
   ------------------------------------------------------------------- */
const FILTER_IDS = ['fMarca','fCliente','fRegiao','fUF','fMes','fAno','fStatus','fPagamento','fMetaAtingida','fFaixa'];
const FIELD_BY_FILTER = {
  fMarca:'fabrica', fCliente:'cliente', fRegiao:'regiao', fUF:'uf', fMes:'mes', fAno:'ano',
  fStatus:'status', fPagamento:'tipoPagamento', fMetaAtingida:'metaAtingida', fFaixa:'faixaPerformance'
};

function uniqueSorted(arr){
  return [...new Set(arr.filter(v => v !== null && v !== undefined && v !== ''))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
}

function populateFilterOptions(){
  const opts = {
    fMarca: uniqueSorted(DATA.map(d=>d.fabrica)),
    fCliente: uniqueSorted(DATA.map(d=>d.cliente)),
    fRegiao: uniqueSorted(DATA.map(d=>d.regiao)),
    fUF: uniqueSorted(DATA.map(d=>d.uf)),
    fMes: uniqueSorted(DATA.map(d=>d.mes)).sort((a,b)=>mesSortKey(a)-mesSortKey(b)),
    fAno: uniqueSorted(DATA.map(d=>d.ano)),
    fPagamento: uniqueSorted(DATA.map(d=>d.tipoPagamento))
  };
  Object.entries(opts).forEach(([id, values]) => {
    const sel = document.getElementById(id);
    const current = new Set(Array.from(sel.selectedOptions).map(o=>o.value));
    sel.innerHTML = '';
    values.forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      if(current.has(v)) o.selected = true;
      sel.appendChild(o);
    });
  });
}

function getActiveFilters(){
  const f = {};
  FILTER_IDS.forEach(id => {
    const sel = document.getElementById(id);
    const vals = Array.from(sel.selectedOptions).map(o=>o.value);
    if(vals.length) f[FIELD_BY_FILTER[id]] = new Set(vals);
  });
  return f;
}

function applyFilters(){
  const f = getActiveFilters();
  return DATA.filter(r => {
    return Object.entries(f).every(([field, set]) => set.has(String(r[field])));
  });
}

/* ---------------------------------------------------------------------
   3. FORMATAÇÃO
   ------------------------------------------------------------------- */
const fmtMoney = v => 'R$ ' + (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtInt = v => (v||0).toLocaleString('pt-BR');
const fmtPct = v => (v===null||v===undefined||isNaN(v)) ? '—' : v.toFixed(1).replace('.', ',')+'%';

/* ---------------------------------------------------------------------
   4. KPIs
   ------------------------------------------------------------------- */
function computeKPIs(rows){
  const totalCampanhas = rows.length;
  const clientesAtivos = new Set(rows.map(r=>r.fabrica+'|'+r.cliente)).size;
  const investimentoTotal = rows.reduce((s,r)=>s+(r.custoFinal||r.custoPrevisto||0),0);
  const metaTotal = rows.reduce((s,r)=> s + (typeof r.metaCampanha==='number' ? r.metaCampanha : 0), 0);
  const resultadoObtido = rows.reduce((s,r)=>s+(r.realizado||0),0);
  const comMeta = rows.filter(r=>typeof r.metaCampanha==='number' && r.metaCampanha>0 && r.pctAtingimento!==null);
  const pctMedio = comMeta.length ? comMeta.reduce((s,r)=>s+r.pctAtingimento,0)/comMeta.length : null;
  const acimaMeta = rows.filter(r=>r.pctAtingimento!==null && r.pctAtingimento>=100).length;
  const criticas = rows.filter(r=>r.faixaPerformance==='Crítico').length;
  return {totalCampanhas, clientesAtivos, investimentoTotal, metaTotal, resultadoObtido, pctMedio, acimaMeta, criticas};
}

function renderKPIs(rows){
  const k = computeKPIs(rows);
  const cards = [
    {label:'Total de Campanhas', value: fmtInt(k.totalCampanhas), accent:'blue', foot:'No período filtrado'},
    {label:'Clientes Ativos', value: fmtInt(k.clientesAtivos), accent:'royal', foot:'Marca × Cliente únicos'},
    {label:'Investimento Total', value: fmtMoney(k.investimentoTotal), accent:'sky', foot:'Custo final realizado'},
    {label:'Meta Total', value: fmtInt(k.metaTotal), accent:'tiffany', foot:'Soma das metas numéricas'},
    {label:'Resultado Obtido', value: fmtInt(k.resultadoObtido), accent:'tiffany', foot:'Soma do realizado'},
    {label:'% Médio de Atingimento', value: fmtPct(k.pctMedio), accent: k.pctMedio>=100?'good':'royal', foot:'Média das campanhas com meta'},
    {label:'Campanhas Acima da Meta', value: fmtInt(k.acimaMeta), accent:'good', foot:'≥ 100% de atingimento'},
    {label:'Campanhas Críticas', value: fmtInt(k.criticas), accent:'bad', foot:'< 80% de atingimento'}
  ];
  const grid = document.getElementById('kpiGrid');
  grid.innerHTML = cards.map(c => `
    <div class="kpi-card accent-${c.accent}">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-foot">${c.foot}</div>
    </div>`).join('');
}

/* ---------------------------------------------------------------------
   5. GRÁFICOS (Chart.js)
   ------------------------------------------------------------------- */
let charts = {};
function destroyChart(id){ if(charts[id]) { charts[id].destroy(); delete charts[id]; } }

const baseGridColor = '#E3E9EF';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#5C6B79';

function groupSum(rows, keyFn, valFn){
  const map = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    if(k===null||k===undefined||k==='') return;
    if(!map.has(k)) map.set(k, 0);
    map.set(k, map.get(k) + (valFn(r)||0));
  });
  return map;
}

function renderChartMarcas(rows){
  destroyChart('marcas');
  const metaMap = groupSum(rows, r=>r.fabrica, r=> typeof r.metaCampanha==='number'?r.metaCampanha:0);
  const realMap = groupSum(rows, r=>r.fabrica, r=>r.realizado);
  const labels = [...new Set([...metaMap.keys(), ...realMap.keys()])]
    .sort((a,b)=>(realMap.get(b)||0)-(realMap.get(a)||0)).slice(0,10);
  const metaData = labels.map(l=>metaMap.get(l)||0);
  const realData = labels.map(l=>realMap.get(l)||0);
  const pctData = labels.map((l,i)=> metaData[i]>0 ? Math.round((realData[i]/metaData[i])*1000)/10 : null);

  charts.marcas = new Chart(document.getElementById('chartMarcas'), {
    type:'bar',
    data:{
      labels,
      datasets:[
        {type:'bar', label:'Meta', data:metaData, backgroundColor:COLORS.grafite, borderRadius:4, yAxisID:'y'},
        {type:'bar', label:'Resultado', data:realData, backgroundColor:COLORS.cobalto, borderRadius:4, yAxisID:'y'},
        {type:'line', label:'% Atingimento', data:pctData, borderColor:COLORS.tiffany, backgroundColor:COLORS.tiffany, yAxisID:'y1', tension:.3, pointRadius:3}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      scales:{
        y:{beginAtZero:true, grid:{color:baseGridColor}},
        y1:{beginAtZero:true, position:'right', grid:{display:false}, ticks:{callback:v=>v+'%'}},
        x:{grid:{display:false}}
      },
      plugins:{legend:{position:'bottom', labels:{boxWidth:12}}}
    }
  });
}

function renderChartClientes(rows){
  destroyChart('clientes');
  const realMap = groupSum(rows, r=>r.cliente, r=>r.realizado);
  const entries = [...realMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  charts.clientes = new Chart(document.getElementById('chartClientes'), {
    type:'bar',
    data:{
      labels: entries.map(e=>e[0]),
      datasets:[{label:'Resultado Realizado', data: entries.map(e=>e[1]), backgroundColor:COLORS.royal, borderRadius:4}]
    },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales:{x:{beginAtZero:true, grid:{color:baseGridColor}}, y:{grid:{display:false}}},
      plugins:{legend:{display:false}}
    }
  });
}

function renderChartRegiao(rows){
  destroyChart('regiao');
  const ufMap = groupSum(rows, r=>r.uf, r=>r.realizado);
  const entries = [...ufMap.entries()].sort((a,b)=>b[1]-a[1]);
  const palette = [COLORS.cobalto, COLORS.royal, COLORS.ceu, COLORS.tiffany, COLORS.indigo, COLORS.grafite, COLORS.atencao, COLORS.critico, COLORS.good];
  charts.regiao = new Chart(document.getElementById('chartRegiao'), {
    type:'bar',
    data:{
      labels: entries.map(e=>e[0]),
      datasets:[{label:'Resultado por Estado', data:entries.map(e=>e[1]), backgroundColor: entries.map((_,i)=>palette[i%palette.length]), borderRadius:4}]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{y:{beginAtZero:true, grid:{color:baseGridColor}}, x:{grid:{display:false}}},
      plugins:{legend:{display:false}}
    }
  });
}

function renderChartEvolucao(rows){
  destroyChart('evolucao');
  const metaMap = groupSum(rows, r=>r.mes, r=> typeof r.metaCampanha==='number'?r.metaCampanha:0);
  const realMap = groupSum(rows, r=>r.mes, r=>r.realizado);
  const labels = [...new Set([...metaMap.keys(), ...realMap.keys()])].sort((a,b)=>mesSortKey(a)-mesSortKey(b));
  charts.evolucao = new Chart(document.getElementById('chartEvolucao'), {
    type:'line',
    data:{
      labels,
      datasets:[
        {label:'Meta', data: labels.map(l=>metaMap.get(l)||0), borderColor:COLORS.grafite, backgroundColor:'rgba(182,184,186,.15)', fill:true, tension:.35},
        {label:'Realizado', data: labels.map(l=>realMap.get(l)||0), borderColor:COLORS.cobalto, backgroundColor:'rgba(0,94,150,.15)', fill:true, tension:.35}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{y:{beginAtZero:true, grid:{color:baseGridColor}}, x:{grid:{display:false}}},
      plugins:{legend:{position:'bottom'}}
    }
  });
}

function renderChartPagamento(rows){
  destroyChart('pagamento');
  const map = groupSum(rows, r=>r.tipoPagamento, ()=>1);
  const labels = [...map.keys()];
  const colorFor = {'Em Dinheiro':COLORS.cobalto, 'Em Peça':COLORS.royal, 'Bonificação':COLORS.tiffany, 'Outros':COLORS.grafite};
  charts.pagamento = new Chart(document.getElementById('chartPagamento'), {
    type:'doughnut',
    data:{labels, datasets:[{data: labels.map(l=>map.get(l)), backgroundColor: labels.map(l=>colorFor[l]||COLORS.grafite), borderWidth:2, borderColor:'#fff'}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom', labels:{boxWidth:12}}}}
  });
}

function renderChartFaixa(rows){
  destroyChart('faixa');
  const order = ['Crítico','Atenção','Meta Atingida','Super Performance','Sem Meta'];
  const map = groupSum(rows, r=>r.faixaPerformance, ()=>1);
  const colorFor = {'Crítico':COLORS.critico,'Atenção':COLORS.atencao,'Meta Atingida':COLORS.tiffany,'Super Performance':COLORS.royal,'Sem Meta':COLORS.grafite};
  const labels = order.filter(l=>map.has(l));
  charts.faixa = new Chart(document.getElementById('chartFaixa'), {
    type:'doughnut',
    data:{labels, datasets:[{data: labels.map(l=>map.get(l)), backgroundColor: labels.map(l=>colorFor[l]), borderWidth:2, borderColor:'#fff'}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom', labels:{boxWidth:12}}}}
  });
}

function renderTop10(rows, id, key, ascending, chartKey, color){
  destroyChart(chartKey);
  const comMeta = rows.filter(r=>r.pctAtingimento!==null && !isNaN(r.pctAtingimento));
  const sorted = [...comMeta].sort((a,b)=> ascending ? a.pctAtingimento-b.pctAtingimento : b.pctAtingimento-a.pctAtingimento).slice(0,10);
  charts[chartKey] = new Chart(document.getElementById(id), {
    type:'bar',
    data:{
      labels: sorted.map(r=>`${r.cliente} (${r.fabrica})`),
      datasets:[{label:'% Atingimento', data: sorted.map(r=>r.pctAtingimento), backgroundColor:color, borderRadius:4}]
    },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales:{x:{beginAtZero:true, grid:{color:baseGridColor}, ticks:{callback:v=>v+'%'}}, y:{grid:{display:false}}},
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>ctx.parsed.x.toFixed(1)+'%'}}}
    }
  });
}

function renderAllCharts(rows){
  renderChartMarcas(rows);
  renderChartClientes(rows);
  renderChartRegiao(rows);
  renderChartEvolucao(rows);
  renderChartPagamento(rows);
  renderChartFaixa(rows);
  renderTop10(rows, 'chartTop10', 'pctAtingimento', false, 'top10', COLORS.good);
  renderTop10(rows, 'chartBottom10', 'pctAtingimento', true, 'bottom10', COLORS.critico);
}

/* ---------------------------------------------------------------------
   6. TABELA (DataTables)
   ------------------------------------------------------------------- */
let dataTable = null;
function badgeFaixa(f){
  const map = {'Crítico':'critico','Atenção':'atencao','Meta Atingida':'atingida','Super Performance':'super','Sem Meta':'sem-meta'};
  return `<span class="badge ${map[f]||'sem-meta'}">${f}</span>`;
}
function badgeSimNao(v){
  return `<span class="badge ${v==='Sim'?'sim':'nao'}">${v||'—'}</span>`;
}

function renderTable(rows){
  const body = rows.map(r => [
    r.fabrica||'', r.cliente||'', r.cidade||'', r.uf||'', r.mes||'', r.tipoCampanha||'', r.premiacao||'',
    r.status||'',
    (typeof r.metaCampanha==='number') ? fmtInt(r.metaCampanha) : (r.semMeta ? 'Sem Meta' : '—'),
    fmtInt(r.realizado),
    fmtPct(r.pctAtingimento),
    badgeFaixa(r.faixaPerformance),
    badgeSimNao(r.metaAtingida),
    fmtMoney(r.custoFinal||r.custoPrevisto||0)
  ]);

  if(dataTable){
    dataTable.clear();
    dataTable.rows.add(body);
    dataTable.draw();
  } else {
    dataTable = $('#campaignsTable').DataTable({
      data: body,
      columns: Array.from({length:14}, () => ({})),
      pageLength: 10,
      lengthMenu: [10,25,50,100],
      language: {
        search: 'Pesquisar:', lengthMenu: 'Mostrar _MENU_ registros',
        info: 'Mostrando _START_–_END_ de _TOTAL_ campanhas', infoEmpty: 'Sem registros',
        paginate: {previous:'‹', next:'›'}, zeroRecords: 'Nenhuma campanha encontrada'
      },
      order: [[10,'desc']]
    });
  }
}

/* ---------------------------------------------------------------------
   7. ORQUESTRAÇÃO / EVENTOS
   ------------------------------------------------------------------- */
function refreshAll(){
  const rows = applyFilters();
  renderKPIs(rows);
  renderAllCharts(rows);
  renderTable(rows);
}

function setupFilterEvents(){
  FILTER_IDS.forEach(id => {
    document.getElementById(id).addEventListener('change', refreshAll);
  });
  document.getElementById('clearFilters').addEventListener('click', () => {
    FILTER_IDS.forEach(id => {
      Array.from(document.getElementById(id).options).forEach(o=>o.selected=false);
    });
    refreshAll();
  });
}

function setLastUpdate(){
  const el = document.getElementById('lastUpdate');
  const now = new Date();
  el.textContent = 'Atualizado em ' + now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}

/* ---------------------------------------------------------------------
   8. IMPORTAÇÃO DE PLANILHA (detecção automática de colunas)
   ------------------------------------------------------------------- */
document.getElementById('fileInput').addEventListener('change', function(e){
  const file = e.target.files[0];
  if(!file) return;
  const ext = file.name.split('.').pop().toLowerCase();

  if(ext === 'csv'){
    Papa.parse(file, {
      complete: res => {
        const rows = res.data.filter(r => r.length && r.some(c=>c!==''));
        ingestSheet(rows[0], rows.slice(1));
      }
    });
  } else {
    const reader = new FileReader();
    reader.onload = ev => {
      const wb = XLSX.read(ev.target.result, {type:'binary', cellDates:true});
      // procura a aba com mais colunas reconhecíveis no cabeçalho
      let best = null, bestScore = -1;
      wb.SheetNames.forEach(name => {
        const sheet = wb.Sheets[name];
        const json = XLSX.utils.sheet_to_json(sheet, {header:1, raw:true});
        for(let i=0;i<Math.min(json.length,10);i++){
          const row = json[i];
          if(!row) continue;
          const score = row.filter(c => HEADER_MAP[normalizeHeader(c)]).length;
          if(score > bestScore){ bestScore = score; best = {rows: json, headerRow: i}; }
        }
      });
      if(best && bestScore >= 3){
        const headers = best.rows[best.headerRow];
        const body = best.rows.slice(best.headerRow+1);
        ingestSheet(headers, body);
      } else {
        alert('Não foi possível identificar automaticamente as colunas da planilha. Verifique se os cabeçalhos seguem o padrão do Controle de Campanhas RBR.');
      }
    };
    reader.readAsBinaryString(file);
  }
});

function ingestSheet(headers, rows){
  const parsed = rows.map(r => rowFromImported(headers, r)).filter(Boolean);
  if(!parsed.length){
    alert('Nenhuma campanha válida foi encontrada na planilha importada.');
    return;
  }
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
    'Marca': r.fabrica, 'Cliente': r.cliente, 'Cidade': r.cidade, 'UF': r.uf, 'Mês': r.mes,
    'Tipo Campanha': r.tipoCampanha, 'Premiação': r.premiacao, 'Status': r.status,
    'Meta': (typeof r.metaCampanha==='number') ? r.metaCampanha : (r.semMeta ? 'Sem Meta' : ''),
    'Realizado': r.realizado, '% Atingimento': r.pctAtingimento, 'Faixa': r.faixaPerformance,
    'Meta Atingida': r.metaAtingida, 'Custo Previsto': r.custoPrevisto, 'Custo Final': r.custoFinal
  }));
  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Campanhas RBR');
  XLSX.writeFile(wb, 'RBR_Campanhas_Filtradas.xlsx');
});

document.getElementById('exportPDF').addEventListener('click', () => {
  const rows = applyFilters();
  const k = computeKPIs(rows);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'landscape'});
  doc.setFontSize(16);
  doc.setTextColor(0,94,150);
  doc.text('RBR — Painel Executivo de Campanhas de Venda 2026', 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(90,100,110);
  doc.text(`Total de campanhas: ${k.totalCampanhas}   |   Investimento total: ${fmtMoney(k.investimentoTotal)}   |   % médio de atingimento: ${fmtPct(k.pctMedio)}`, 14, 23);

  doc.autoTable({
    startY: 28,
    head: [['Marca','Cliente','UF','Mês','Status','Meta','Realizado','% Atingimento','Faixa','Meta Atingida']],
    body: rows.map(r => [
      r.fabrica, r.cliente, r.uf, r.mes, r.status,
      (typeof r.metaCampanha==='number') ? fmtInt(r.metaCampanha) : (r.semMeta?'Sem Meta':'—'),
      fmtInt(r.realizado), fmtPct(r.pctAtingimento), r.faixaPerformance, r.metaAtingida
    ]),
    styles:{fontSize:7},
    headStyles:{fillColor:[19,63,104]}
  });
  doc.save('RBR_Campanhas_Filtradas.pdf');
});

/* ---------------------------------------------------------------------
   10. BOOT
   ------------------------------------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  try{
    loadEmbeddedData();
    populateFilterOptions();
    setLastUpdate();
    setupFilterEvents();
    refreshAll();
  } catch(err){
    console.error('Erro ao iniciar o painel RBR:', err);
    const loaderText = document.querySelector('#loader p');
    if(loaderText){
      loaderText.textContent = 'Ocorreu um erro ao carregar o painel. Verifique a console (F12) para detalhes.';
    }
  } finally {
    setTimeout(() => document.getElementById('loader').classList.add('hidden'), 600);
  }
});
