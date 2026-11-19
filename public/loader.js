/**
 * The "loading games" screen: a sliding puck, what is being loaded and a list of the games with their state. Shown while Studio
 * starts (looking for your games, then loading the first one) and while a folder, ROM or disc image is read.
 *
 *   const run = NhlLoader.start('Opening folder', 'nhl94-files');   // returns a handle
 *   run.games([{id, title, state: 'found' | 'missing' | 'loading' | 'done'}]);
 *   run.detail('Loading NHL 94…');
 *   run.done();
 *
 * It waits a moment before appearing (a fast load shows nothing) and then stays long enough to read.
 */
(function (root) {
  const SHOW_AFTER = 180;
  const SHOW_AT_LEAST = 450;
  let overlay = null;
  let active = 0;

  function build() {
    const box = document.createElement('div');
    box.className = 'loader';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.hidden = true;
    box.innerHTML = '<div class="loader-card">' +
      '<div class="loader-rink" aria-hidden="true"><span class="loader-puck"></span><span class="loader-trail"></span></div>' +
      '<h2 class="loader-title"></h2><p class="loader-detail"></p><ul class="loader-games"></ul></div>';
    document.body.appendChild(box);
    return box;
  }

  const STATES = { found: 'found on disk', missing: 'not found', loading: 'loading…', done: 'loaded' };

  function start(title, detail) {
    if (!overlay) overlay = build();
    const box = overlay;
    const run = { heading: title || 'Loading games', text: detail || '', list: [], shownAt: 0, ended: false, timer: 0, id: ++active };
    const paint = () => {
      box.querySelector('.loader-title').textContent = run.heading;
      box.querySelector('.loader-detail').textContent = run.text;
      const ul = box.querySelector('.loader-games');
      ul.replaceChildren();
      for (const g of run.list) {
        const li = document.createElement('li');
        li.dataset.state = g.state || 'found';
        const name = document.createElement('span');
        name.textContent = g.title;
        const state = document.createElement('em');
        state.textContent = STATES[g.state] || '';
        li.append(name, state);
        ul.appendChild(li);
      }
      ul.hidden = !run.list.length;
    };
    const show = () => {
      if (run.ended || active !== run.id) return;
      run.shownAt = Date.now();
      paint();
      box.hidden = false;
      document.body.setAttribute('aria-busy', 'true');
    };
    run.timer = setTimeout(show, SHOW_AFTER);
    const repaint = () => { if (run.shownAt && !run.ended && active === run.id) paint(); };
    run.detail = function (text) { run.text = text; repaint(); };
    run.games = function (list) { run.list = list; repaint(); };
    run.mark = function (id, state) {
      const g = run.list.find((x) => x.id === id);
      if (g) { g.state = state; repaint(); }
    };
    run.done = function () {
      if (run.ended) return;
      run.ended = true;
      clearTimeout(run.timer);
      const hide = () => {
        if (active === run.id) { box.hidden = true; document.body.removeAttribute('aria-busy'); }
      };
      if (!run.shownAt) { hide(); return; }
      setTimeout(hide, Math.max(0, SHOW_AT_LEAST - (Date.now() - run.shownAt)));
    };
    return run;
  }

  root.NhlLoader = { start };
})(typeof self !== 'undefined' ? self : this);
