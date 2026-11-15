(() => {
  'use strict';
  const data = window.PBS_DATA;
  const byId = id => document.getElementById(id);
  const format = value => Number(value).toLocaleString('it-IT', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const integer = value => Number(value).toLocaleString('it-IT');
  const total = student => Math.round(student.voti.reduce((sum, score) => sum + score, 0) * 10) / 10;
  const normalise = value => {
    const clean = value.replace(/\s+/g, '').toLocaleUpperCase('it-IT');
    return /^\d+\.0+$/.test(clean) ? clean.replace(/\.0+$/, '') : clean;
  };
  if (!data || !Array.isArray(data.students)) {
    byId('lookup-error').textContent = 'I dati non sono disponibili. Ricarica la pagina.';
    byId('lookup-form').querySelector('button').disabled = true;
    return;
  }
  const students = data.students;
  const active = students.filter(student => !student.ritirato);
  const lookup = new Map(students.map(student => [normalise(student.matricola), student]));
  const totals = active.map(total).sort((a, b) => a - b);
  const middle = Math.floor(totals.length / 2);
  const median = totals.length % 2 ? totals[middle] : (totals[middle - 1] + totals[middle]) / 2;
  byId('stat-count').textContent = integer(active.length);
  const withdrawn = students.length - active.length;
  byId('stat-registered').textContent = `${integer(students.length)} iscritti · ${integer(withdrawn)} ${withdrawn === 1 ? 'ritirato' : 'ritirati'}`;
  byId('stat-mean').textContent = format(totals.reduce((sum, value) => sum + value, 0) / totals.length);
  byId('stat-median').textContent = format(median);
  byId('distribution-count').textContent = `${integer(active.length)} compiti`;
  const date = new Date(`${data.updatedAt}T12:00:00`);
  byId('updated-at').textContent = `Aggiornato il ${date.toLocaleDateString('it-IT', {day: 'numeric', month: 'short', year: 'numeric'})}`;

  const bins = [{label: '< 8', description: 'Voti inferiori a 8', low: -Infinity, high: 8}, ...Array.from({length: 8}, (_, i) => ({label: `${i + 8}–${i + 9}`, description: i === 7 ? 'Da 15 a 16, incluso' : `Da ${i + 8} a meno di ${i + 9}`, low: i + 8, high: i === 7 ? Infinity : i + 9}))];
  const indexFor = score => score < 8 ? 0 : Math.min(8, Math.floor(score) - 7);
  bins.forEach((bin, index) => { bin.count = totals.filter(score => indexFor(score) === index).length; });
  const ceiling = Math.ceil((Math.max(...bins.map(bin => bin.count)) + 3) / 6) * 6;
  // Six equal grid steps, matching the six background grid lines.
  const plotHeight = () => document.querySelector('.chart-grid').getBoundingClientRect().height;
  bins.forEach((bin, index) => {
    const column = document.createElement('div');
    column.className = 'bin-column';
    column.dataset.bin = String(index);
    column.setAttribute('role', 'img');
    column.setAttribute('aria-label', `${bin.description}: ${bin.count} compiti`);
    const bar = document.createElement('div');
    bar.className = 'bar';
    const count = document.createElement('span');
    count.className = 'bar-count';
    count.textContent = integer(bin.count);
    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = bin.label;
    bar.append(count);
    column.append(bar, label);
    byId('histogram-bars').append(column);
    const row = document.createElement('tr');
    for (const value of [bin.description, integer(bin.count), `${format(bin.count / active.length * 100)}%`]) {
      const td = document.createElement('td'); td.textContent = value; row.append(td);
    }
    byId('distribution-table').append(row);
  });
  for (let step = 0; step <= 6; step++) {
    const label = document.createElement('span');
    label.textContent = integer(ceiling * step / 6);
    label.style.bottom = `${step / 6 * 100}%`;
    byId('chart-y-axis').append(label);
  }
  function sizeBars() {
    const height = plotHeight();
    document.querySelectorAll('.bin-column').forEach((column, index) => {
      column.style.setProperty('--bar-height', `${bins[index].count / ceiling * height}px`);
    });
  }
  sizeBars();
  if ('ResizeObserver' in window) new ResizeObserver(sizeBars).observe(document.querySelector('.chart-grid'));
  else window.addEventListener('resize', sizeBars);
  for (const band of [{label: 'Meno di 8', low: -Infinity, high: 8}, {label: 'Da 8 a meno di 12', low: 8, high: 12}, {label: 'Da 12 a meno di 14', low: 12, high: 14}, {label: 'Da 14 a 16', low: 14, high: Infinity}]) {
    const count = totals.filter(score => score >= band.low && score < band.high).length;
    const box = document.createElement('div');
    const number = document.createElement('strong'); number.textContent = integer(count);
    const label = document.createElement('span'); label.textContent = band.label;
    const percent = document.createElement('small'); percent.textContent = `${format(count / active.length * 100)}% dei compiti`;
    box.append(number, label, percent); byId('band-summary').append(box);
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  data.similarity.points.forEach(point => {
    const circle = document.createElementNS(svgNS, 'circle');
    // Use one scale for both axes: do not distort pairwise geometry.
    circle.setAttribute('cx', (300 + point[0] * 340).toFixed(3));
    circle.setAttribute('cy', (210 - point[1] * 340).toFixed(3));
    circle.setAttribute('r', '4.5');
    byId('map-points').append(circle);
  });
  byId('map-count').textContent = `${integer(data.similarity.points.length)} compiti`;
  byId('projection-variance').textContent = `La mappa mantiene in media il ${format(data.similarity.neighborPreservation * 100)}% dei dieci vicini più prossimi di ogni compito. Non conserva tutte le relazioni: le distanze e gli spazi fra gruppi non sono misure esatte.`;

  const topics = ['Glia radiale', 'BDNF e periodo critico', 'Cure materne e grafici HPA', 'Cognizione prenatale', 'Ormoni e comportamento materno', 'Conditioned head turning', 'Nodi di Ranvier', 'Deprivazione monoculare', 'Harlow e base sicura', 'Patterning telencefalico', 'Disparità retinica', 'Pratica motoria e M1'];
  function clearChartSelection() {
    document.querySelectorAll('.bin-column.selected').forEach(column => column.classList.remove('selected'));
    byId('selected-bin').hidden = true;
  }
  function resetResult() {
    byId('student-result').hidden = true;
    byId('open-scores').replaceChildren();
    byId('tf-scores').replaceChildren();
    clearChartSelection();
  }
  function showStudent(student) {
    resetResult();
    byId('result-id').textContent = `Matricola ${student.matricola}`;
    byId('student-result').hidden = false;
    byId('withdrawn-notice').hidden = !student.ritirato;
    byId('score-detail').hidden = Boolean(student.ritirato);
    if (!student.ritirato) {
      const score = total(student);
      byId('student-total').textContent = format(score);
      byId('open-total').textContent = format(student.voti.slice(0, 4).reduce((sum, value) => sum + value, 0));
      byId('tf-total').textContent = format(student.voti.slice(4).reduce((sum, value) => sum + value, 0));
      const binIndex = indexFor(score);
      byId('student-bin').textContent = binIndex === 0 ? 'Nella distribuzione, il tuo compito è nella fascia «< 8», senza una posizione interna alla fascia.' : `Nella distribuzione, il tuo compito è nella fascia «${bins[binIndex].label}».`;
      byId('selected-bin-text').textContent = `Il tuo intervallo: ${bins[binIndex].label} · ${integer(bins[binIndex].count)} compiti nella stessa fascia`;
      byId('selected-bin').hidden = false;
      document.querySelector(`.bin-column[data-bin="${binIndex}"]`).classList.add('selected');
      student.voti.forEach((value, index) => {
        const maximum = index < 4 ? 2 : 1;
        const row = document.createElement('div');
        row.className = 'question-row'; row.dataset.question = String(index + 1);
        const id = document.createElement('span'); id.className = 'question-id'; id.textContent = `D${index + 1}`;
        const topic = document.createElement('span'); topic.className = 'question-topic'; topic.textContent = topics[index];
        const grade = document.createElement('span'); grade.className = 'question-grade'; grade.textContent = format(value);
        const max = document.createElement('small'); max.textContent = ` / ${maximum}`; grade.append(max);
        const track = document.createElement('span'); track.className = 'grade-track'; track.setAttribute('aria-hidden', 'true');
        const fill = document.createElement('span'); fill.className = 'grade-fill'; fill.style.width = `${value / maximum * 100}%`; track.append(fill);
        row.append(id, topic, grade, track); byId(index < 4 ? 'open-scores' : 'tf-scores').append(row);
      });
    }
    byId('lookup-announcement').textContent = student.ritirato ? 'Matricola trovata. Risulta un ritiro.' : `Matricola trovata. Voto totale: ${format(total(student))} su 16. Dettaglio di dodici domande disponibile.`;
    byId('result-title').focus({preventScroll: true});
    byId('student-result').scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
  }
  byId('lookup-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = byId('matricola');
    const identifier = normalise(input.value);
    byId('lookup-error').textContent = '';
    input.removeAttribute('aria-invalid');
    if (!identifier || !lookup.has(identifier)) {
      resetResult();
      byId('lookup-error').textContent = identifier ? 'Matricola non trovata. Controlla di averla scritta correttamente.' : 'Inserisci la matricola per consultare il risultato.';
      input.setAttribute('aria-invalid', 'true'); input.focus(); return;
    }
    showStudent(lookup.get(identifier));
  });
  byId('matricola').addEventListener('input', () => {
    byId('lookup-error').textContent = ''; byId('matricola').removeAttribute('aria-invalid');
  });
  byId('hide-result').addEventListener('click', () => {
    resetResult(); byId('matricola').value = ''; byId('lookup-announcement').textContent = 'Risultato nascosto.'; byId('matricola').focus();
  });
  byId('clear-selection').addEventListener('click', clearChartSelection);
})();
