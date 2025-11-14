const CSV_PATH = 'data/PBS_mod1_2025.csv';
const OPEN_QS = [1, 2, 3, 4];
const VF_QS = [5, 6, 7, 8, 9, 10, 11, 12];

let rows = [];
let charts = {};
let currentID = null;
let histLabelsNumeric = [];

// registra plugin Annotation per Chart.js v4 (global UMD = ChartAnnotation)
if (window.ChartAnnotation) {
    Chart.register(window.ChartAnnotation);
}

function mean(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;
}

// costruisce istogramma con ampiezza adattiva
function buildHistogram(values) {
    const v = [...values].sort((a, b) => a - b);
    if (!v.length) {
        return { bins: [0], counts: [0], width: 1 };
    }
    const q1 = v[Math.floor(0.25 * (v.length - 1))];
    const q3 = v[Math.floor(0.75 * (v.length - 1))];
    const iqr = q3 - q1 || 1;
    const binWidth = Math.max(0.5, (2 * iqr) / Math.cbrt(v.length));
    const minV = v[0], maxV = v[v.length - 1];
    const nBins = Math.max(1, Math.ceil((maxV - minV) / binWidth));
    const width = (maxV - minV || 1) / nBins;
    const bins = Array.from({ length: nBins }, (_, i) => minV + i * width);
    const counts = new Array(nBins).fill(0);
    v.forEach(val => {
        let idx = Math.floor((val - minV) / width);
        if (idx >= nBins) idx = nBins - 1;
        if (idx < 0) idx = 0;
        counts[idx]++;
    });
    return { bins, counts, width };
}

// indice del bin più vicino a un certo valore
function closestBinIndex(value) {
    if (!histLabelsNumeric.length) return 0;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < histLabelsNumeric.length; i++) {
        const d = Math.abs(histLabelsNumeric[i] - value);
        if (d < bestDiff) {
            bestDiff = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function loadCSV() {
    Papa.parse(CSV_PATH, {
        download: true,
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
            rows = results.data.map(r => ({
                id: String(r['ID number']).trim(),
                total: Number(r['Results']),
                scores: Array.from({ length: 12 }, (_, i) => Number(r[`Voto ${i + 1}`]))
            }));
            document.getElementById('datasetInfo').textContent = `${rows.length} studenti`;
            buildAllCharts();
            setupAutocomplete();
        }
    });
}

function buildAllCharts() {
    buildHistogramChart();
    buildScatterCharts();
}

// ---------------------------------------------------------
// DISTRIBUZIONE VOTI
// ---------------------------------------------------------
function buildHistogramChart() {
    const ctx = document.getElementById('histChart');
    const vals = rows.map(r => r.total);
    const mu = mean(vals);
    const { bins, counts, width } = buildHistogram(vals);

    const labels = bins.map(b => (b + width / 2).toFixed(1));
    histLabelsNumeric = bins.map(b => b + width / 2);

    charts.hist?.destroy();
    charts.hist = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Distribuzione',
                    data: counts,
                    backgroundColor: 'rgba(125,211,252,0.25)',
                    borderColor: 'rgba(125,211,252,0.9)',
                    borderWidth: 1
                },
                {
                    label: 'Media',
                    type: 'line',
                    data: labels.map((_, i) => i === closestBinIndex(mu) ? counts[i] : null),
                    borderColor: '#34d399',
                    borderWidth: 3,
                    pointRadius: 8,
                    pointBackgroundColor: '#34d399'
                },
                {
                    label: 'Studente',
                    type: 'line',
                    data: labels.map(() => null),      // we fill this later in updateHighlight
                    borderColor: '#f87171',
                    borderWidth: 0,
                    pointRadius: 12,                   // bigger so it is visible
                    pointBackgroundColor: '#f87171',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                }
            ]
        },
        options: {
            scales: {
                x: { grid: { color: '#1f1f27' } },
                y: {
                    beginAtZero: true,
                    grid: { color: '#1f1f27' }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
}


// ---------------------------------------------------------
// SCATTER 1–4 e 5–12
// ---------------------------------------------------------
function buildScatterCharts() {
    const makeData = (qs) => {
        const points = [];
        const jitter = () => (Math.random() - 0.5) * 0.15;
        rows.forEach(r => {
            qs.forEach(q => {
                points.push({ x: q + jitter(), y: r.scores[q - 1], id: r.id });
            });
        });
        const means = qs.map(q => ({ x: q, y: mean(rows.map(r => r.scores[q - 1])) }));
        return { points, means };
    };

    const openData = makeData(OPEN_QS);
    const vfData = makeData(VF_QS);

    const opts = (minX, maxX) => ({
        scales: {
            x: { min: minX - 0.5, max: maxX + 0.5, grid: { color: '#1f1f27' } },
            y: { grid: { color: '#1f1f27' } }
        },
        plugins: { legend: { display: false } }
    });

    charts.open && charts.open.destroy();
    charts.vf && charts.vf.destroy();

    // scatter domande aperte
    charts.open = new Chart(document.getElementById('openScatter'), {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Studenti',
                    data: openData.points,
                    pointRadius: 3,
                    pointBackgroundColor: 'rgba(125,211,252,0.45)',
                    pointBorderColor: 'rgba(125,211,252,0.9)'
                },
                {
                    label: 'Media',
                    type: 'line',
                    data: openData.means,
                    borderColor: '#34d399',
                    borderWidth: 2,
                    pointRadius: 0
                },
                {
                    label: 'Selezionato',
                    data: [],
                    pointRadius: 7,
                    pointBackgroundColor: '#f87171',
                    pointBorderColor: '#fef3c7',
                    order: 9999
                }
            ]
        },
        options: opts(1, 4)
    });
    // salvo tutti i punti originali per ripristino
    charts.open._allPoints = charts.open.data.datasets[0].data.slice();

    // scatter V/F
    charts.vf = new Chart(document.getElementById('vfScatter'), {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Studenti',
                    data: vfData.points,
                    pointRadius: 3,
                    pointBackgroundColor: 'rgba(125,211,252,0.45)',
                    pointBorderColor: 'rgba(125,211,252,0.9)'
                },
                {
                    label: 'Media',
                    type: 'line',
                    data: vfData.means,
                    borderColor: '#34d399',
                    borderWidth: 2,
                    pointRadius: 0
                },
                {
                    label: 'Selezionato',
                    data: [],
                    pointRadius: 7,
                    pointBackgroundColor: '#f87171',
                    pointBorderColor: '#fef3c7',
                    order: 9999
                }
            ]
        },
        options: opts(5, 12)
    });
    charts.vf._allPoints = charts.vf.data.datasets[0].data.slice();
}

// ---------------------------------------------------------
// AUTOCOMPLETE
// ---------------------------------------------------------
function setupAutocomplete() {
    const input = document.getElementById('matricola');
    const list = document.getElementById('suggestions');
    const legend = document.getElementById('legendStatus');

    input.addEventListener('input', () => {
        const term = input.value.trim();
        currentID = null;
        const rec = rows.find(r => r.id === term);
        legend.innerHTML = rec
            ? `<div class="matricola-label">Matricola ${term}</div>
     <div class="voto-label">Voto: <span>${rec.total}</span></div>`
            : 'Nessuna matricola selezionata.';

        updateHighlight();

        if (term.length < 3) {
            list.style.display = 'none';
            return;
        }
        const matches = rows.filter(r => r.id.includes(term)).slice(0, 5);
        list.innerHTML = matches.map(m => `<li>${m.id}</li>`).join('');
        list.style.display = matches.length ? 'block' : 'none';
    });

    list.addEventListener('click', e => {
        if (e.target.tagName === 'LI') {
            input.value = e.target.textContent;
            list.style.display = 'none';
            currentID = input.value.trim();
            const rec = rows.find(r => r.id === currentID);
            legend.innerHTML = rec
                ? `<div class="matricola-label">Matricola ${currentID}</div>
     <div class="voto-label">Voto: <span>${rec.total}</span></div>`
                : `<div class="matricola-label">Matricola ${currentID}</div>`;
            updateHighlight();
        }
    });

    document.addEventListener('click', e => {
        if (!list.contains(e.target) && e.target !== input) list.style.display = 'none';
    });
}

// ---------------------------------------------------------
// EVIDENZIAZIONE
// ---------------------------------------------------------
function updateHighlight() {
    if (!charts.hist) return;

    const id = currentID;
    const rec = rows.find(r => String(r.id) === String(id));

    // ---------------------------------------------------------
    // HISTOGRAM: only show big red point on the student bin
    // ---------------------------------------------------------
    const dsStudent = charts.hist.data.datasets[2];  // red point dataset
    const dsMean = charts.hist.data.datasets[1];     // green point dataset

    if (rec) {
        const idx = closestBinIndex(rec.total);

        dsStudent.data = charts.hist.data.labels.map((_, i) =>
            i === idx ? charts.hist.data.datasets[0].data[i] : null
        );

    } else {
        dsStudent.data = charts.hist.data.labels.map(() => null);
    }

    charts.hist.update();


    // ---------------------------------------------------------
    // SCATTERPLOTS: show ONLY student’s points + mean line
    // ---------------------------------------------------------
    const updateScatter = (chart) => {
        if (!chart || !chart._allPoints) return;

        if (!rec) {
            // RESET: show all students again
            chart.data.datasets[0].data = chart._allPoints.slice();  // background
            chart.data.datasets[2].data = [];                        // selected empty
            chart.update();
            return;
        }

        // ONLY selected student's points
        const allPoints = chart._allPoints;
        const sel = allPoints.filter(p => String(p.id) === String(id));

        chart.data.datasets[0].data = [];   // remove all background students
        chart.data.datasets[2].data = sel;  // keep only selected student
        chart.update();
    };

    updateScatter(charts.open);
    updateScatter(charts.vf);
}

// ---------------------------------------------------------
window.addEventListener('DOMContentLoaded', loadCSV);
