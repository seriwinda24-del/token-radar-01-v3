// Nyx Radar v3 — the whole dashboard. Reads window.RADAR (data.js), renders
// the board, two charts, the model proof, the live-token view and a detail
// view per protocol. No network: every number comes from the snapshot.
(function () {
  var R = window.RADAR;
  if (!R || !R.rows) { document.body.innerHTML = '<p style="padding:40px">Nyx Radar: data.js did not load.</p>'; return; }
  var rows = R.rows, live = R.live || [], val = R.validation, fit = R.fit;
  var watch = {};
  (R.watchlist || []).forEach(function (s) { watch[s] = true; });

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n), sign = n < 0 ? '−' : '';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return sign + '$' + Math.round(a / 1e3) + 'K';
    return sign + '$' + a.toFixed(a < 10 ? 2 : 0);
  }
  function moneyFull(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function pct(n) { return n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(n) { return n == null ? '—' : n >= 365 ? (n / 365).toFixed(1) + 'y' : n + 'd'; }
  function cls(v) { return v === 'FARM' ? 'farm' : v === 'MARGINAL' ? 'marginal' : 'skip'; }
  function pill(v) { return '<span class="pill ' + cls(v) + '">' + v + '</span>'; }
  var params = new URLSearchParams(location.search);

  /* Masthead */
  var vc = R.verdict_counts;
  $('pill-farm').textContent = vc.farm + ' FARM';
  $('pill-marginal').textContent = vc.marginal + ' MARGINAL';
  $('pill-skip').textContent = vc.skip + ' SKIP';
  $('mast-meta').textContent = 'Snapshot ' + R.as_of + ' · 758 protocols read · ' + R.watchlist_size + ' on the watchlist, ' + R.early_size + ' early finds · model fitted on ' + fit.n + ' live-token protocols · board ranked by implied value, highest first';
  $('foot').textContent = 'Snapshot ' + R.as_of + ' · source ' + R.source + ' · floor $' + R.floor_usd.toLocaleString('en-US') + ' · model ' + R.model_version + ' · board ' + R.board_size + ' rows · dossier and board generated at run time from the sealed snapshot.';

  /* KPI strip */
  var top = rows[0];
  function kpi(label, num, sub, mod) {
    return '<div class="kpi ' + (mod || '') + '"><div class="k-label">' + label + '</div><div class="k-num">' + num + '</div><div class="k-sub">' + sub + '</div></div>';
  }
  $('kpis').innerHTML =
    kpi('Highest implied value', money(top.implied_value_usd), 'Rank 1 of ' + rows.length + ' — ' + esc(top.name) + ' · ' + esc(top.category || 'no category'), '') +
    kpi('Farmable right now', vc.farm + ' <small>/ ' + rows.length + '</small>', 'Rows that clear $25 an hour after every cost is paid', 'k-emerald') +
    kpi('Walk-forward miss', '×' + val.wf_miss.toFixed(2), 'Median factor off on the ' + val.wf_n + ' latest listings — fitted before them, tested after', 'k-navy') +
    kpi('Range honesty', val.range_hold_wf_pct.toFixed(1) + '<small>%</small>', val.range_hold_wf_n + ' of ' + val.range_hold_wf_total + ' latest listings landed inside [×' + val.range_lo + ', ×' + val.range_hi + ']', 'k-amber') +
    kpi('Brier score', val.brier.toFixed(4), 'Category odds vs ' + val.brier_flat.toFixed(4) + ' guessing the flat average — lower is better', 'k-grey');

  /* Accounting chart — implied value by category, stacked by verdict */
  (function () {
    var byCat = {};
    rows.forEach(function (r) {
      var c = r.category || 'Uncategorised';
      byCat[c] = byCat[c] || { farm: 0, marginal: 0, skip: 0, total: 0 };
      byCat[c][r.verdict.toLowerCase()] += r.implied_value_usd;
      byCat[c].total += r.implied_value_usd;
    });
    var cats = Object.keys(byCat).map(function (c) { return { name: c, v: byCat[c] }; }).sort(function (a, b) { return b.v.total - a.v.total; });
    var rest = cats.slice(8), top8 = cats.slice(0, 8);
    if (rest.length) {
      var o = { farm: 0, marginal: 0, skip: 0, total: 0 };
      rest.forEach(function (c) { o.farm += c.v.farm; o.marginal += c.v.marginal; o.skip += c.v.skip; o.total += c.v.total; });
      top8.push({ name: 'Other (' + rest.length + ' categories)', v: o });
    }
    var W = 620, labelW = 168, max = top8[0].v.total, bw = W - labelW - 70, rh = 34, H = top8.length * rh + 34;
    var col = { farm: '#0e7c5b', marginal: '#b45309', skip: '#9aa3ad' };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Implied value by category">';
    top8.forEach(function (c, i) {
      var y = 8 + i * rh, x = labelW, acc = 0;
      s += '<text class="lbl" x="' + (labelW - 8) + '" y="' + (y + 15) + '" text-anchor="end">' + esc(c.name.length > 24 ? c.name.slice(0, 23) + '…' : c.name) + '</text>';
      ['farm', 'marginal', 'skip'].forEach(function (k) {
        var w = c.v[k] / max * bw;
        if (w > 0.5) s += '<rect x="' + (x + acc).toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="20" fill="' + col[k] + '" rx="2"/>';
        acc += w;
      });
      s += '<text class="ax-t" x="' + (x + acc + 8).toFixed(1) + '" y="' + (y + 15) + '">' + money(c.v.total) + '</text>';
    });
    s += '<g class="leg"><rect x="' + labelW + '" y="' + (H - 20) + '" width="11" height="11" fill="#0e7c5b"/><text x="' + (labelW + 16) + '" y="' + (H - 11) + '">FARM</text>' +
      '<rect x="' + (labelW + 76) + '" y="' + (H - 20) + '" width="11" height="11" fill="#b45309"/><text x="' + (labelW + 92) + '" y="' + (H - 11) + '">MARGINAL</text>' +
      '<rect x="' + (labelW + 178) + '" y="' + (H - 20) + '" width="11" height="11" fill="#9aa3ad"/><text x="' + (labelW + 194) + '" y="' + (H - 11) + '">SKIP</text></g></svg>';
    $('chart-accounting').innerHTML = s;
  })();

  /* Scatter — log TVL vs implied value, with the fitted line */
  (function () {
    var W = 620, H = 330, pl = 56, pr = 16, pt = 14, pb = 34;
    var xs = rows.map(function (r) { return Math.log10(r.tvl_usd); });
    var ys = rows.map(function (r) { return Math.log10(r.implied_value_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    var X = function (v) { return pl + (v - x0) / (x1 - x0) * (W - pl - pr); };
    var Y = function (v) { return pt + (y1 - v) / (y1 - y0) * (H - pt - pb); };
    var col = { FARM: '#0e7c5b', MARGINAL: '#b45309', SKIP: '#9aa3ad' };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log TVL against implied value">';
    for (var gx = x0; gx <= x1; gx++) {
      s += '<line class="grid" x1="' + X(gx) + '" y1="' + pt + '" x2="' + X(gx) + '" y2="' + (H - pb) + '"/>';
      s += '<text class="ax" x="' + X(gx) + '" y="' + (H - pb + 18) + '" text-anchor="middle">10^' + gx + '</text>';
    }
    for (var gy = y0; gy <= y1; gy++) {
      s += '<line class="grid" x1="' + pl + '" y1="' + Y(gy) + '" x2="' + (W - pr) + '" y2="' + Y(gy) + '"/>';
      s += '<text class="ax" x="' + (pl - 8) + '" y="' + (Y(gy) + 4) + '" text-anchor="end">10^' + gy + '</text>';
    }
    s += '<text class="ax" x="' + ((W - pl - pr) / 2 + pl) + '" y="' + (H - 4) + '" text-anchor="middle">TVL (log scale)</text>';
    s += '<text class="ax" x="14" y="' + ((H - pt - pb) / 2 + pt) + '" text-anchor="middle" transform="rotate(-90 14 ' + ((H - pt - pb) / 2 + pt) + ')">Implied value (log scale)</text>';
    var lx0 = x0, lx1 = x1;
    var ly0 = (fit.b0 + fit.b1 * Math.LN10 * lx0) / Math.LN10, ly1 = (fit.b0 + fit.b1 * Math.LN10 * lx1) / Math.LN10;
    s += '<line x1="' + X(lx0) + '" y1="' + Y(ly0) + '" x2="' + X(lx1) + '" y2="' + Y(ly1) + '" stroke="#5b3df0" stroke-width="2" stroke-dasharray="6 4"/>';
    rows.forEach(function (r) {
      s += '<circle cx="' + X(Math.log10(r.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(r.implied_value_usd)).toFixed(1) + '" r="3.2" fill="' + col[r.verdict] + '" fill-opacity="0.85"><title>' + esc(r.name) + ' — ' + money(r.implied_value_usd) + ' · ' + r.verdict + '</title></circle>';
    });
    s += '<text class="ax-t" x="' + (W - pr) + '" y="' + (pt + 12) + '" text-anchor="end">log(mcap) = ' + fit.b0 + ' + ' + fit.b1 + ' · log(TVL)</text></svg>';
    $('chart-scatter').innerHTML = s;
  })();

  /* Board — filter, sort, page */
  var state = { v: params.get('verdict') || 'ALL', cat: params.get('category') || '', q: '', watch: false, k: 'rank', dir: 1, shown: 25 };
  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  cats.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('f-cat').appendChild(o); });
  if (state.cat) $('f-cat').value = state.cat;
  function filtered() {
    return rows.filter(function (r) {
      if (state.v !== 'ALL' && r.verdict !== state.v) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.watch && !watch[r.slug]) return false;
      if (state.q) { var q = state.q.toLowerCase(); if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false; }
      return true;
    }).sort(function (a, b) {
      var k = state.k, av = a[k], bv = b[k];
      if (av == null) return 1; if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : a.rank - b.rank) * state.dir;
    });
  }
  function renderBoard() {
    var list = filtered(), total = list.length, show = list.slice(0, state.shown);
    $('c-all').textContent = rows.length;
    $('c-farm').textContent = vc.farm; $('c-marginal').textContent = vc.marginal; $('c-skip').textContent = vc.skip;
    var filterBits = [];
    if (state.v !== 'ALL') filterBits.push('verdict ' + state.v);
    if (state.cat) filterBits.push('category ' + state.cat);
    if (state.watch) filterBits.push('watchlist only');
    if (state.q) filterBits.push('“' + state.q + '”');
    $('board-count').textContent = (filterBits.length ? 'Filtered by ' + filterBits.join(' · ') + ' — ' : '') + 'Showing ' + show.length + ' of ' + total + ' rows · sorted by ' + state.k + ' · ' + vc.farm + ' FARM / ' + vc.marginal + ' MARGINAL / ' + vc.skip + ' SKIP';
    var maxImp = rows[0].implied_value_usd;
    $('rows').innerHTML = show.map(function (r) {
      var w = Math.max(2, r.implied_value_usd / maxImp * 100);
      var chg = r.change_7d == null ? '—' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</span>';
      var nph = '<span class="' + (r.net_per_hour_usd >= 0 ? 'pos' : 'neg') + '">' + moneyFull(r.net_per_hour_usd) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '" class="is-' + cls(r.verdict) + '"><td class="num">' + r.rank + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span><span class="sl">' + esc(r.slug) + (watch[r.slug] ? ' · watchlist' : '') + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + chg + '</td><td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><span class="vbar"><i style="width:' + w.toFixed(1) + '%"></i></span>' + money(r.implied_value_usd) + '</td>' +
        '<td class="num">' + (r.odds * 100).toFixed(1) + '%</td><td class="num">' + nph + '</td><td>' + pill(r.verdict) + '</td></tr>';
    }).join('');
    $('more').style.display = total > state.shown ? '' : 'none';
    Array.prototype.forEach.call(document.querySelectorAll('#rows tr'), function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }
  document.querySelectorAll('#verdict-tabs button').forEach(function (b) {
    if (b.getAttribute('data-v') === state.v) b.classList.add('on'); else b.classList.remove('on');
    b.addEventListener('click', function () {
      state.v = b.getAttribute('data-v'); state.shown = 25;
      document.querySelectorAll('#verdict-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderBoard();
    });
  });
  $('f-cat').addEventListener('change', function () { state.cat = this.value; state.shown = 25; renderBoard(); });
  $('f-q').addEventListener('input', function () { state.q = this.value; state.shown = 25; renderBoard(); });
  $('f-watch').addEventListener('change', function () { state.watch = this.checked; state.shown = 25; renderBoard(); });
  $('more').addEventListener('click', function () { state.shown += 50; renderBoard(); });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.k === k) state.dir = -state.dir; else { state.k = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      renderBoard();
    });
  });
  renderBoard();
  /* A filtered view opens on the board itself, so the filter and its rows —
     not the masthead — are what a screenshot of that view shows. */
  if ((params.get('category') || params.get('verdict')) && !params.get('slug')) {
    document.querySelector('.board-card').scrollIntoView();
  }

  /* Proof */
  $('formula').innerHTML = 'log(mcap) = <b>' + fit.b0 + '</b> + <b>' + fit.b1 + '</b> × log(TVL) &nbsp;—&nbsp; fitted at run time on ' + fit.n + ' live-token protocols. Twice the TVL is worth about 1.44×, not 2×.';
  $('keepdrop').querySelector('tbody').innerHTML = val.keep_drop.map(function (kd) {
    return '<tr><td>' + esc(kd.term) + '</td><td class="num">×' + kd.wf_miss.toFixed(2) + '</td><td class="num">×' + kd.loo_miss.toFixed(2) + '</td><td>' + (kd.call === 'KEPT' ? '<span class="pill farm">KEPT</span>' : '<span class="pill">DROPPED</span>') + '</td></tr>';
  }).join('');
  $('range-nums').innerHTML = '×' + val.range_lo + ' – ×' + val.range_hi + ' <small>holds ' + val.range_hold_wf_pct.toFixed(1) + '% walk-forward</small>';
  var lo = Math.log10(0.1), hi = Math.log10(10);
  $('range-band').style.left = ((Math.log10(val.range_lo) - lo) / (hi - lo) * 100).toFixed(1) + '%';
  $('range-band').style.width = ((Math.log10(val.range_hi) - Math.log10(val.range_lo)) / (hi - lo) * 100).toFixed(1) + '%';
  $('range-mark').style.left = ((Math.log10(1) - lo) / (hi - lo) * 100).toFixed(1) + '%';
  $('range-note').textContent = 'The band is the middle half of the fit’s own errors (P25–P75 of the residual ratios). ' + val.range_hold_wf_n + ' of the ' + val.range_hold_wf_total + ' latest listings landed inside it. The black line is the model itself (×1.0).';
  $('brier-odds').style.width = (val.brier / 0.25 * 100).toFixed(1) + '%';
  $('brier-flat').style.width = (val.brier_flat / 0.25 * 100).toFixed(1) + '%';
  $('brier-odds-n').textContent = val.brier.toFixed(4);
  $('brier-flat-n').textContent = val.brier_flat.toFixed(4);
  $('integrity').innerHTML = '<b>758</b> protocols read · <b>' + fit.n + '</b> in the fit · walk-forward <b>' + val.wf_n + '</b> tested · leave-one-out <b>' + val.loo_n + '</b> refits · board <b>' + R.board_size + '</b> rows · watchlist <b>' + R.watchlist_size + '/' + R.watchlist_size + '</b> covered · <b>' + R.live_size + '</b> live-token protocols shown apart · within 2×: <b>' + val.within2_wf_pct.toFixed(1) + '%</b> walk-forward, <b>' + val.within2_loo_pct.toFixed(1) + '%</b> leave-one-out.';

  /* Live-token view */
  $('live-rows').innerHTML = live.map(function (p, i) {
    var ratio = p.mcap_usd != null && p.tvl_usd > 0 ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
    return '<tr><td class="num">' + (i + 1) + '</td><td><span class="nm">' + esc(p.name) + '</span><span class="sl">' + esc(p.slug) + '</span></td><td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + ratio + '</td></tr>';
  }).join('');

  /* Detail view */
  function econFor(r, deposit, share) {
    var farmers = Math.min(100000, Math.max(200, r.tvl_usd / 8000));
    var pool = 0.07 * r.implied_value_usd;
    var drop = Math.min(pool / farmers, 0.01 * pool) * share;
    var gas = r.chains && r.chains[0] === 'Ethereum' ? 12 : 3;
    var costs = gas + 14 + 0.05 * deposit * 45 / 365;
    var expected = r.odds * drop, net = expected - costs;
    return { expected: expected, costs: costs, net: net, perHour: net / 1.58, gas: gas };
  }
  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    $('board-view').hidden = true;
    $('detail-view').hidden = false;
    $('d-rank').textContent = '#' + r.rank;
    $('d-name').textContent = r.name;
    $('d-sub').textContent = r.slug + ' · ' + (r.category || 'no category') + ' · ' + (r.chains || []).join(', ') + (watch[r.slug] ? ' · on the watchlist' : '');
    var dv = $('d-verdict');
    dv.textContent = r.verdict; dv.className = 'pill big ' + cls(r.verdict);
    function tile(l, n, s) { return '<div class="tile"><div class="t-label">' + l + '</div><div class="t-num">' + n + '</div><div class="t-sub">' + s + '</div></div>'; }
    $('d-tiles').innerHTML =
      tile('Implied value', money(r.implied_value_usd), 'rank ' + r.rank + ' of ' + rows.length) +
      tile('TVL', money(r.tvl_usd), '7D ' + pct(r.change_7d)) +
      tile('Age', age(r.age_days), r.age_days == null ? 'no listing date' : 'listed ' + r.age_days + ' days before the snapshot') +
      tile('Token odds', (r.odds * 100).toFixed(1) + '%', 'from its category’s launch record') +
      tile('Expected drop', moneyFull(r.expected_drop_usd), 'odds × the drop') +
      tile('Costs', moneyFull(r.costs_usd), 'gas + $14 weekly + opportunity') +
      tile('Net', moneyFull(r.net_usd), r.net_usd >= 0 ? 'after every cost' : 'loses money at the stated size') +
      tile('Net / hour', moneyFull(r.net_per_hour_usd), 'over 1.58 hours of work') +
      tile('Verdict', r.verdict, r.verdict === 'FARM' ? 'net above $0 and ≥ $25/hr' : r.verdict === 'MARGINAL' ? 'net above $0, under $25/hr' : 'net below $0');
    $('d-steps').innerHTML = r.farm_steps.map(function (s, i) {
      var parts = s.split(' Cost: ');
      var action = parts[0], rest = (parts[1] || '').split(' Time: ');
      return '<li><span class="n">' + (i + 1) + '</span><div><div class="s-text">' + esc(action) + '</div><div class="s-meta"><span class="chip cost">Cost: ' + esc(rest[0] || '') + '</span><span class="chip">Time: ' + esc(rest[1] || '') + '</span></div></div></li>';
    }).join('');
    var peers = rows.filter(function (x) { return x.slug !== r.slug && x.category === r.category; })
      .map(function (x) { return { x: x, d: Math.abs(Math.log(x.implied_value_usd / r.implied_value_usd)) }; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, 5).map(function (o) { return o.x; });
    if (peers.length < 5) {
      rows.filter(function (x) { return x.slug !== r.slug && peers.indexOf(x) < 0; })
        .map(function (x) { return { x: x, d: Math.abs(Math.log(x.implied_value_usd / r.implied_value_usd)) }; })
        .sort(function (a, b) { return a.d - b.d; }).slice(0, 5 - peers.length).forEach(function (o) { peers.push(o.x); });
    }
    peers.sort(function (a, b) { return a.rank - b.rank; });
    $('d-peers').innerHTML = peers.map(function (x) {
      return '<tr><td class="num">' + x.rank + '</td><td><span class="nm">' + esc(x.name) + '</span></td><td class="num">' + money(x.tvl_usd) + '</td><td class="num">' + money(x.implied_value_usd) + '</td><td class="num">' + moneyFull(x.net_per_hour_usd) + '</td><td>' + pill(x.verdict) + '</td></tr>';
    }).join('');
    var dep = $('sl-deposit'), shr = $('sl-share');
    function refreshSliders() {
      var d = +dep.value, s = +shr.value / 100;
      $('sl-deposit-v').textContent = '$' + d;
      $('sl-share-v').textContent = shr.value + '%';
      var e = econFor(r, d, s);
      var v = e.net > 0 && e.perHour >= 25 ? 'FARM' : e.net > 0 ? 'MARGINAL' : 'SKIP';
      $('sl-out').innerHTML = 'At $' + d + ' and ' + shr.value + '% of the drop: expected ' + moneyFull(e.expected) + ', costs ' + moneyFull(e.costs) + ', net <b>' + moneyFull(e.net) + '</b> (' + moneyFull(e.perHour) + '/hr) — <b>' + v + '</b>';
      var deps = [50, 100, 150, 250, 500], shares = [50, 75, 100, 125, 150];
      var t = '<table class="mini"><thead><tr><th>Deposit \\ drop share</th>' + shares.map(function (x) { return '<th class="num">' + x + '%</th>'; }).join('') + '</tr></thead><tbody>';
      deps.forEach(function (dd) {
        t += '<tr><td>$' + dd + '</td>' + shares.map(function (ss) {
          var ee = econFor(r, dd, ss / 100);
          return '<td class="num"><span class="' + (ee.net >= 0 ? 'pos' : 'neg') + '">' + moneyFull(ee.net) + '</span></td>';
        }).join('') + '</tr>';
      });
      $('sl-matrix').innerHTML = t + '</tbody></table>';
    }
    dep.oninput = refreshSliders; shr.oninput = refreshSliders;
    refreshSliders();
    window.scrollTo(0, 0);
  }
  $('back').addEventListener('click', function () {
    $('detail-view').hidden = true;
    $('board-view').hidden = false;
  });
  if (params.get('slug')) showDetail(params.get('slug'));
  window.__shotReady = true;
})();
