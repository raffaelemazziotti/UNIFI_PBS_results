Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = true;
Chart.defaults.devicePixelRatio = window.devicePixelRatio || 2;

const CSV_PATH = 'data/PBS_mod1_mod2.csv';

const COLOR_STUDENTS = 'rgba(125,211,252,0.45)';
const COLOR_STUDENTS_BORDER = 'rgba(125,211,252,0.9)';
const COLOR_MEAN = '#34d399';
const COLOR_SELECTED = '#f87171';

const OPEN_Q = [1,2,3,4];
const VF_Q = [5,6,7,8,9,10,11,12];

let rows = [];
let charts = {};
let currentID = null;
let currentMode = 'total';
let currentQMode = 'mod1';

/* ---------------- UTIL ---------------- */

const mean = arr => arr.reduce((a,b)=>a+b,0)/arr.length;
const jitter = () => (Math.random()-0.5)*0.15;

/* ---------------- LOAD CSV ---------------- */

Papa.parse(CSV_PATH, {
  download: true,
  header: true,
  dynamicTyping: true,
  complete: res => {
    rows = res.data.map(r => ({
      id: String(r['ID number']).trim(),
      mod1: r['Results_mod1'],
      mod2: r['Results_mod2'],
      total: r['Total'],
      mod1_q: Array.from({length:12},(_,i)=>r[`Voto ${i+1}_mod1`]),
      mod2_q: Array.from({length:12},(_,i)=>r[`Voto ${i+1}_mod2`])
    }));

    document.getElementById('datasetInfo').textContent = `${rows.length} studenti`;

    buildHistogram();
    buildQuestionCharts();
    setupTabs();
    setupSearch();
  }
});

/* ---------------- HISTOGRAM ---------------- */

function buildHistogram() {
  const ctx = document.getElementById('histChart');

  const values =
    currentMode === 'mod1' ? rows.map(r=>r.mod1) :
    currentMode === 'mod2' ? rows.map(r=>r.mod2) :
    rows.map(r=>r.total);

  const max = currentMode === 'total' ? 32 : 16;
  const bins = max;
  const counts = Array(bins).fill(0);

  values.forEach(v=>{
    const idx = Math.min(Math.floor(v), bins-1);
    counts[idx]++;
  });

  const mu = mean(values);
  const muIdx = Math.min(Math.floor(mu), bins-1);

  charts.hist?.destroy();
  charts.hist = new Chart(ctx,{
    type:'bar',
    data:{
      labels:[...Array(bins).keys()],
      datasets:[
        {
          data:counts,
          backgroundColor:COLOR_STUDENTS,
          borderColor:COLOR_STUDENTS_BORDER
        },
        {
          type:'line',
          data:counts.map((v,i)=>i===muIdx?v:null),
          pointRadius:8,
          pointBackgroundColor:COLOR_MEAN
        },
        {
          type:'line',
          data:counts.map(()=>null),
          pointRadius:12,
          pointBackgroundColor:COLOR_SELECTED,
          pointBorderColor:'#fff',
          pointBorderWidth:2
        }
      ]
    },
    options:{
      plugins:{legend:{display:false}},
      scales:{y:{beginAtZero:true}}
    }
  });

  updateHistogramStudent();
}

function updateHistogramStudent() {
  if (!currentID) return;

  const rec = rows.find(r=>r.id===currentID);
  if (!rec) return;

  const v =
    currentMode==='mod1'?rec.mod1:
    currentMode==='mod2'?rec.mod2:
    rec.total;

  const idx = Math.min(Math.floor(v), charts.hist.data.labels.length-1);
  charts.hist.data.datasets[2].data[idx] =
    charts.hist.data.datasets[0].data[idx];

  charts.hist.update();
}

/* ---------------- SCATTER ---------------- */

function buildScatter(canvasId, qIdx, getVals, yRange = null) {
  const ctx = document.getElementById(canvasId);

  const studentPoints = [];
  const meanLines = [];

  qIdx.forEach(q => {
    const vals = rows
      .map(r => getVals(r)[q - 1])
      .filter(v => v !== null && v !== undefined);

    const m = mean(vals);

    // mean horizontal segment (THIS IS THE KEY)
    meanLines.push(
      { x: q - 0.4, y: m },
      { x: q + 0.4, y: m },
      { x: null, y: null } // break line
    );

    rows.forEach(r => {
      studentPoints.push({
        x: q + jitter(),
        y: getVals(r)[q - 1],
        id: r.id
      });
    });
  });

  const chart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Studenti',
          data: studentPoints,
          pointRadius: 3,
          pointBackgroundColor: COLOR_STUDENTS,
          pointBorderColor: COLOR_STUDENTS_BORDER
        },
        {
          label: 'Media',
          type: 'line',
          data: meanLines,
          borderColor: COLOR_MEAN,
          borderWidth: 3,
          pointRadius: 0
        },
        {
          label: 'Selezionato',
          data: [],
          pointRadius: 6,
          pointBackgroundColor: COLOR_SELECTED,
          pointBorderColor: '#ffffff',
          order: 10
        }
      ]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: {
          type: 'linear',
          min: Math.min(...qIdx) - 0.6,
          max: Math.max(...qIdx) + 0.6,
          ticks: {
            stepSize: 1,
            callback: v => Number.isInteger(v) ? v : ''
          }
        },
        y: {
          beginAtZero: yRange ? false : true,
          min: yRange ? yRange[0] : undefined,
          max: yRange ? yRange[1] : undefined,
          ticks: yRange ? { stepSize: 1 } : {},
          grid: { color: '#1f1f27' }
        }
      }
    }
  });

  chart._allPoints = studentPoints.slice();
  return chart;
}


function buildQuestionCharts() {
  charts.open?.destroy();
  charts.vf?.destroy();

  if (currentQMode==='mod1') {
    charts.open = buildScatter('openQuestions',OPEN_Q,r=>r.mod1_q, [-0.1, 2.1]);
    charts.vf = buildScatter('vfQuestions', VF_Q, r => r.mod1_q,[-0.3, 1.1]);
  } else {
    charts.open = buildScatter('openQuestions',OPEN_Q,r=>r.mod2_q,[-0.1, 2.1]);
    charts.vf   = buildScatter('vfQuestions',VF_Q,r=>r.mod2_q,[-0.3, 1.1]);
  }
}

/* ---------------- SEARCH ---------------- */

function setupSearch() {
  const input = document.getElementById('matricola');
  const list = document.getElementById('suggestions');

  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      applyMatricola(input.value.trim());
    }
  });

  input.addEventListener('input',()=>{
    const term=input.value.trim();
    if(term.length<3){list.style.display='none';return;}
    const m=rows.filter(r=>r.id.includes(term)).slice(0,5);
    list.innerHTML=m.map(x=>`<li>${x.id}</li>`).join('');
    list.style.display=m.length?'block':'none';
  });

  list.addEventListener('click',e=>{
    if(e.target.tagName==='LI'){
      input.value=e.target.textContent;
      applyMatricola(e.target.textContent);
      list.style.display='none';
    }
  });
}

function applyMatricola(id) {
  const rec = rows.find(r=>r.id===id);

  if (!rec) {
    document.getElementById('legendStatus').textContent = 'Matricola non trovata';
    return; // ← stato di default
  }

  currentID = id;

  document.getElementById('legendStatus').textContent = '';
  document.getElementById('studentPanel').style.display='block';
  document.getElementById('studentID').textContent=`Matricola ${id}`;
  document.getElementById('resMod1').textContent=rec.mod1;
  document.getElementById('resMod2').textContent=rec.mod2;
  document.getElementById('resTotal').textContent=rec.total;

  buildHistogram();
  updateScatterHighlight();
}

function updateScatterHighlight() {
  if (!currentID) return;

  [charts.open,charts.vf].forEach(chart=>{
    if(!chart)return;
    const sel=chart._allPoints.filter(p=>p.id===currentID);
    chart.data.datasets[0].data=[];   // remove others
    chart.data.datasets[2].data=sel;  // keep selected
    chart.update();
  });
}

/* ---------------- TABS ---------------- */

function setupTabs() {
  document.querySelectorAll('[data-mode]').forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll('[data-mode]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      currentMode=b.dataset.mode;
      buildHistogram();
    };
  });

  document.querySelectorAll('[data-qmode]').forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll('[data-qmode]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      currentQMode=b.dataset.qmode;
      buildQuestionCharts();
      if(currentID) updateScatterHighlight();
    };
  });
}
