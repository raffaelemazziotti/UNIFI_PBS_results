const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');

const root = path.resolve(__dirname, '..');
const sandbox = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/data.js'), 'utf8'), sandbox);
const data = JSON.parse(JSON.stringify(sandbox.window.PBS_DATA));
const active = data.students.filter(student => !student.ritirato);
const sum = student => Math.round(student.voti.reduce((a, b) => a + b, 0) * 10) / 10;
const format = number => number.toLocaleString('it-IT', {minimumFractionDigits: 1, maximumFractionDigits: 1});

(async () => {
  assert.equal(data.students.length, 98);
  assert.equal(active.length, 97);
  for (const student of data.students) {
    assert.deepEqual(Object.keys(student).sort(), student.ritirato ? ['matricola', 'ritirato'] : ['matricola', 'voti']);
    assert(/^[A-Z0-9]+$/.test(student.matricola));
    if (!student.ritirato) assert.equal(student.voti.length, 12);
  }
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1080}, reducedMotion: 'reduce'});
    const errors = []; const external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {if (/^https?:/.test(request.url())) external.push(request.url());});
    await page.goto(pathToFileURL(path.join(root, 'docs/index.html')).href);
    await page.waitForFunction(() => document.querySelectorAll('.bin-column').length === 9);
    assert.equal(await page.title(), 'PBS modulo 1');
    assert.equal(await page.locator('#stat-count').textContent(), '97');
    assert.equal(await page.locator('#stat-mean').textContent(), '12,7');
    assert.equal(await page.locator('#stat-median').textContent(), '13,7');
    assert.equal(await page.locator('#map-points circle').count(), 97);
    assert.equal(await page.locator('#student-result').isVisible(), false);
    const counts = await page.locator('.bar-count').allTextContents();
    assert.equal(counts.reduce((a, b) => a + Number(b), 0), 97);
    assert.equal(await page.locator('.bar-label').first().textContent(), '< 8');
    await page.locator('#lookup-form button').click();
    assert.match(await page.locator('#lookup-error').textContent(), /Inserisci/);
    await page.locator('#matricola').fill('<script>non_esiste</script>');
    await page.locator('#lookup-form button').click();
    assert.match(await page.locator('#lookup-error').textContent(), /non trovata/);
    assert.equal(await page.locator('#student-result').isVisible(), false);

    const ordinary = active.find(student => sum(student) >= 12 && sum(student) < 16);
    await page.locator('#matricola').fill(` ${ordinary.matricola.toLowerCase()}.0 `);
    await page.locator('#matricola').press('Enter');
    assert.equal(await page.locator('#student-total').textContent(), format(sum(ordinary)));
    assert.equal(await page.locator('.question-row').count(), 12);
    assert.equal(await page.locator('#open-scores .question-row').count(), 4);
    assert.equal(await page.locator('#tf-scores .question-row').count(), 8);
    assert.equal(await page.locator('.bin-column.selected').count(), 1);
    assert.equal(await page.locator('#result-title').evaluate(el => el === document.activeElement), true);
    assert(!page.url().includes(ordinary.matricola));
    for (let i = 0; i < 12; i++) {
      assert.equal(await page.locator(`[data-question="${i + 1}"] .question-grade`).textContent(), `${format(ordinary.voti[i])} / ${i < 4 ? 2 : 1}`);
    }

    fs.mkdirSync(path.join(root, 'PBS'), {recursive: true});
    await page.screenshot({path: path.join(root, 'PBS/anteprima_portale_risultato.png'), fullPage: true});
    const lows = active.filter(student => sum(student) < 8);
    assert.equal(lows.length, 5);
    for (const student of lows) {
      await page.locator('#matricola').fill(student.matricola);
      await page.locator('#matricola').press('Enter');
      assert.equal(await page.locator('.bin-column.selected').getAttribute('data-bin'), '0');
      assert.match(await page.locator('#student-bin').textContent(), /senza una posizione interna/);
    }
    await page.locator('#matricola').fill(data.students.find(student => student.ritirato).matricola);
    await page.locator('#matricola').press('Enter');
    assert.equal(await page.locator('#withdrawn-notice').isVisible(), true);
    assert.equal(await page.locator('#score-detail').isVisible(), false);
    assert.equal(await page.locator('.bin-column.selected').count(), 0);
    await page.locator('#hide-result').click();
    assert.equal(await page.locator('#student-result').isVisible(), false);
    assert.equal(await page.locator('#matricola').inputValue(), '');

    // Every public score can be looked up without mixing students or maxima.
    for (const student of active) {
      await page.locator('#matricola').fill(student.matricola);
      await page.locator('#matricola').press('Enter');
      assert.equal(await page.locator('#student-total').textContent(), format(sum(student)));
      assert.equal(await page.locator('.question-row').count(), 12);
    }
    await page.locator('#hide-result').click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({path: path.join(root, 'PBS/anteprima_portale_desktop.png'), fullPage: true});
    for (const width of [320, 375, 390, 768, 1024, 1440]) {
      await page.setViewportSize({width, height: 900});
      const dimensions = await page.evaluate(() => ({content: document.documentElement.scrollWidth, viewport: innerWidth}));
      assert(dimensions.content <= dimensions.viewport + 1, `Overflow at ${width}px`);
    }
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({path: path.join(root, 'PBS/anteprima_portale_mobile.png'), fullPage: true});
    const ids = await page.locator('[id]').evaluateAll(elements => elements.map(element => element.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    console.log('Browser OK: 98 matricole, 97 dettagli, 12 voti, ritiro, fascia <8 aggregata, grafici, tastiera, responsive 320–1440px; nessuna richiesta esterna.');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exit(1);});
