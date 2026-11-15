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

  const bins = [{label: '< 8', description: 'Voti inferiori a 8'}, ...Array.from({length: 8}, (_, i) => ({label: `${i + 8}–${i + 9}`, description: i === 7 ? 'Da 15 a 16, incluso' : `Da ${i + 8} a meno di ${i + 9}`}))];
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
  const mapPoints = new Map();
  const tooltip = byId('map-tooltip');
  function hideMapTooltip() { tooltip.hidden = true; }
  function showMapTooltip(group, point) {
    tooltip.textContent = `Matricola ${point.matricola}${group.classList.contains('selected') ? ' · Il tuo compito' : ''}`;
    tooltip.hidden = false;
    const stage = document.querySelector('.map-stage').getBoundingClientRect();
    const anchor = group.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = Math.max(8, Math.min(stage.width - width - 8, anchor.left + anchor.width / 2 - stage.left - width / 2));
    const top = Math.max(8, Math.min(stage.height - height - 8, anchor.top - stage.top - height - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  data.similarity.points.forEach(point => {
    const group = document.createElementNS(svgNS, 'g');
    group.classList.add('map-point');
    group.dataset.matricola = point.matricola;
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-label', `Matricola ${point.matricola}`);
    // Use one scale for both axes: do not distort pairwise geometry.
    group.setAttribute('transform', `translate(${(300 + point.x * 340).toFixed(3)} ${(210 - point.y * 340).toFixed(3)})`);
    const hit = document.createElementNS(svgNS, 'circle');
    hit.classList.add('map-hit'); hit.setAttribute('r', '12'); hit.setAttribute('aria-hidden', 'true');
    const dot = document.createElementNS(svgNS, 'circle');
    dot.classList.add('map-dot'); dot.setAttribute('r', '4.5'); dot.setAttribute('aria-hidden', 'true');
    group.append(hit, dot);
    group.addEventListener('pointerenter', () => showMapTooltip(group, point));
    group.addEventListener('pointerleave', () => {if (document.activeElement !== group) hideMapTooltip();});
    group.addEventListener('focus', () => showMapTooltip(group, point));
    group.addEventListener('blur', hideMapTooltip);
    group.addEventListener('click', () => showMapTooltip(group, point));
    group.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); showMapTooltip(group, point);}
    });
    mapPoints.set(point.matricola, group);
    byId('map-points').append(group);
  });
  byId('map-count').textContent = `${integer(data.similarity.points.length)} compiti`;
  document.addEventListener('pointerdown', event => {if (!event.target.closest('.map-point')) hideMapTooltip();});
  document.addEventListener('keydown', event => {if (event.key === 'Escape') hideMapTooltip();});
  window.addEventListener('resize', hideMapTooltip);
  function selectMapStudent(matricola) {
    hideMapTooltip();
    for (const [id, group] of mapPoints) {
      const selected = id === matricola;
      group.classList.toggle('selected', selected);
      group.setAttribute('aria-label', `Matricola ${id}${selected ? ', il tuo compito' : ''}`);
    }
    byId('map-selected-legend').hidden = !matricola || !mapPoints.has(matricola);
    if (mapPoints.has(matricola)) byId('map-points').append(mapPoints.get(matricola));
  }

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
    selectMapStudent(null);
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
      byId('student-bin').textContent = `Il tuo compito si trova nella fascia «${bins[binIndex].label}».`;
      byId('selected-bin-text').textContent = `Il tuo intervallo: ${bins[binIndex].label} · ${integer(bins[binIndex].count)} compiti nella stessa fascia`;
      byId('selected-bin').hidden = false;
      document.querySelector(`.bin-column[data-bin="${binIndex}"]`).classList.add('selected');
      selectMapStudent(student.matricola);
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
