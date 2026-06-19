// ── ARIA Analytics Panel ───────────────────────────────────────────────────────
// Shown below the output area when a pandas DataFrame is detected.
// Reads real data from the shared Pyodide kernel via a secondary extraction run.

import { compile } from '../../shared/kernel/notebook_kernel.js';

// ── Python extraction script ───────────────────────────────────────────────────
const EXTRACT_PY = `
import json as _j, pandas as _pd, numpy as _np

_a = {}
for _n, _v in list(_dp_kernel_ns.items()):
    if _n.startswith('_') or not isinstance(_v, _pd.DataFrame) or len(_v) == 0:
        continue
    try:
        df = _v
        _num = df.select_dtypes(include='number')
        _cat = df.select_dtypes(include=['object','category'])
        _a['name']   = _n
        _a['shape']  = list(df.shape)
        _a['nulls']  = int(df.isnull().sum().sum())
        _a['memory'] = round(float(df.memory_usage(deep=True).sum() / 1048576), 2)
        _a['numeric_cols'] = list(_num.columns[:8])
        _a['all_cols']     = list(df.columns[:12])

        # Per-column describe
        _a['describe'] = {}
        for _c in _num.columns[:8]:
            _s = df[_c].dropna()
            _a['describe'][_c] = {
                'mean': float(_s.mean()), 'std': float(_s.std() or 0),
                'min': float(_s.min()),   'max': float(_s.max()),
                'q25': float(_s.quantile(.25)), 'q75': float(_s.quantile(.75)),
                'sum': float(_s.sum()),
            }

        # Sparkline: first numeric col, 12 normalised points
        _a['sparkline'] = []
        if len(_num.columns):
            _c = _num.columns[0]
            _s = df[_c].dropna()
            _step = max(1, len(_s) // 12)
            _pts  = _s.iloc[::_step].head(12)
            _mn, _mx = float(_pts.min()), float(_pts.max())
            _r = _mx - _mn or 1
            _a['sparkline'] = [round(float(v - _mn) / _r, 4) for v in _pts]

        # Top-N by first numeric col grouped by first categorical col
        _a['top_values'] = {}; _a['top_col'] = ''; _a['num_col'] = ''
        if len(_cat.columns) and len(_num.columns):
            _cc, _nc = _cat.columns[0], _num.columns[0]
            _grp  = df.groupby(_cc)[_nc].sum().nlargest(5)
            _tot  = float(_grp.sum()) or 1
            _a['top_col'] = _cc; _a['num_col'] = _nc
            for k, v in _grp.items():
                _a['top_values'][str(k)] = round(float(v) / _tot, 4)

        # Anomaly detection: IQR ×1.5 on first numeric col
        _a['anomalies'] = []
        if len(_num.columns):
            _c = _num.columns[0]
            _s = df[_c].dropna()
            _q1, _q3 = _s.quantile(.25), _s.quantile(.75)
            _iqr = _q3 - _q1
            _out = df[
                (df[_c] < _q1 - 1.5 * _iqr) | (df[_c] > _q3 + 1.5 * _iqr)
            ]
            _std = float(_s.std() or 1)
            for idx in _out.index[:5]:
                _z = (_df_v := float(df.loc[idx, _c]))
                _a['anomalies'].append({
                    'row': int(idx),
                    'z':   round((_z - float(_s.mean())) / _std, 1),
                    'val': round(_z, 2),
                })

        # Monthly trend via datetime index
        _a['monthly'] = []
        _dt_cols = df.select_dtypes(include='datetime').columns
        if len(_dt_cols) and len(_num.columns):
            try:
                _mc = df.set_index(_dt_cols[0])[_num.columns[0]].resample('ME').sum()
                _mn, _mx = float(_mc.min()), float(_mc.max())
                _r = _mx - _mn or 1
                _a['monthly'] = [round(float((v - _mn) / _r), 4) for v in _mc.values[-12:]]
            except: pass

        # Null per column for Stock tab
        _a['null_per_col'] = {c: int(df[c].isnull().sum()) for c in df.columns[:10]}

        # Correlation (up to 6 numeric cols) for Trends tab
        _a['corr'] = {}
        if len(_num.columns) >= 2:
            _cs = list(_num.columns[:6])
            _cm = df[_cs].corr()
            for r in _cs:
                _a['corr'][r] = {c: round(float(_cm.loc[r, c]), 3) for c in _cs}

        break   # first matching DataFrame only
    except Exception as _e:
        _a['error'] = str(_e)

print(_j.dumps(_a))
`;

// ── SVG helpers ───────────────────────────────────────────────────────────────

function _barChartSVG(values /* {label, ratio}[] */, w = 190, h = 56) {
  if (!values.length) return '';
  const n = values.length, bw = Math.floor((w - (n - 1) * 3) / n);
  const bars = values.map((v, i) => {
    const bh   = Math.max(2, Math.round(v.ratio * (h - 12)));
    const x    = i * (bw + 3);
    const y    = h - bh;
    const hue  = ['#6366f1','#818cf8','#67e8f9','#4ade80','#fbbf24'][i % 5];
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="2" fill="${hue}" opacity="0.85"/>
            <text x="${x + bw / 2}" y="${h + 10}" text-anchor="middle" font-size="7" fill="#ffffff40">${v.label.slice(0,6)}</text>`;
  }).join('');
  return `<svg width="${w}" height="${h + 12}" viewBox="0 0 ${w} ${h + 12}">${bars}</svg>`;
}

function _sparkSVG(pts /* 0-1 normalised */, w = 190, h = 36, color = '#6366f1') {
  if (pts.length < 2) return '';
  const coords = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * (w - 4) + 2;
    const y = h - 4 - v * (h - 8);
    return `${x},${y}`;
  });
  const polyPts = coords.join(' ');
  const area = `2,${h - 2} ${polyPts} ${w - 2},${h - 2}`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
    <defs><linearGradient id="ag${color.slice(1)}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${area}" fill="url(#ag${color.slice(1)})"/>
    <polyline points="${polyPts}" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${coords[coords.length-1].split(',')[0]}" cy="${coords[coords.length-1].split(',')[1]}" r="2.5" fill="${color}"/>
  </svg>`;
}

function _corrHeatmapSVG(corr /* {col: {col: val}} */, size = 180) {
  const cols = Object.keys(corr);
  if (!cols.length) return '';
  const n = cols.length, cs = Math.floor(size / n);
  const cells = cols.flatMap((r, ri) =>
    cols.map((c, ci) => {
      const v   = corr[r][c] ?? 0;
      const abs = Math.abs(v);
      const clr = v >= 0 ? `rgba(99,102,241,${abs.toFixed(2)})` : `rgba(248,113,113,${abs.toFixed(2)})`;
      return `<rect x="${ci * cs}" y="${ri * cs}" width="${cs - 1}" height="${cs - 1}" rx="1" fill="${clr}"/>`;
    })
  );
  const labels = cols.map((c, i) =>
    `<text x="${i * cs + cs / 2}" y="${n * cs + 10}" text-anchor="middle" font-size="7" fill="#ffffff30">${c.slice(0,4)}</text>`
  );
  return `<svg width="${n * cs}" height="${n * cs + 12}" viewBox="0 0 ${n * cs} ${n * cs + 12}">${cells.join('')}${labels.join('')}</svg>`;
}

// ── DOM builders ──────────────────────────────────────────────────────────────

function _fmt(n) {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toFixed(2);
}

function _buildRevenue(data, body) {
  const desc = data.describe ?? {};
  const cols = Object.keys(desc);
  const mainCol = cols[0];
  const d = mainCol ? desc[mainCol] : null;

  const total   = d ? _fmt(d.sum) : '—';
  const topEntry = Object.entries(data.top_values ?? {})[0];
  const topName  = topEntry ? topEntry[0] : '—';
  const topRatio = topEntry ? (topEntry[1] * 100).toFixed(1) + '%' : '—';
  const anomCount = (data.anomalies ?? []).length;

  // Monthly bar chart
  const monthly = data.monthly ?? data.sparkline ?? [];
  const barVals = (data.top_values && Object.keys(data.top_values).length)
    ? Object.entries(data.top_values).map(([l, r]) => ({ label: l, ratio: r }))
    : [];

  // Insights
  const insights = [];
  if (d) {
    insights.push(`Mean ${mainCol}: ${_fmt(d.mean)}, range [${_fmt(d.min)} – ${_fmt(d.max)}]`);
    insights.push(`Std dev is ${((d.std / (d.mean || 1)) * 100).toFixed(1)}% of mean (coefficient of variation)`);
  }
  if (topEntry) insights.push(`"${topEntry[0]}" accounts for ${(topEntry[1] * 100).toFixed(1)}% of total ${data.num_col}`);
  if (anomCount) insights.push(`${anomCount} outlier${anomCount > 1 ? 's' : ''} detected via IQR × 1.5 method`);
  if (cols.length > 1) insights.push(`${cols.length} numeric columns available for further analysis`);

  body.innerHTML = `
    <div class="aa-grid-3">
      <div class="aa-card">
        <div class="aa-card-label">TOTAL ${(mainCol || 'VALUE').toUpperCase()}</div>
        <div class="aa-card-main aa-green">${total}</div>
        <div class="aa-card-sub">sum · ${data.name ?? 'df'}</div>
        ${d ? `<div class="aa-badges">
          <span class="aa-badge aa-badge-green">↑ mean ${_fmt(d.mean)}</span>
          <span class="aa-badge aa-badge-muted">→ std ${_fmt(d.std)}</span>
        </div>` : ''}
      </div>
      <div class="aa-card">
        <div class="aa-card-label">TOP ${(data.top_col || 'CATEGORY').toUpperCase()}</div>
        <div class="aa-card-main aa-blue">${topName}</div>
        <div class="aa-card-sub">${topRatio} of total</div>
        ${barVals.length ? `<div class="aa-chart">${_barChartSVG(barVals.slice(1))}</div>` : ''}
      </div>
      <div class="aa-card">
        <div class="aa-card-label">ANOMALY DETECTION</div>
        <div class="aa-card-main aa-red">${anomCount}</div>
        <div class="aa-card-sub">outliers found · IQR × 1.5</div>
        <div class="aa-anomaly-list">
          ${(data.anomalies ?? []).map(a =>
            `<div class="aa-anomaly-row">
              <span class="aa-dot ${a.z > 0 ? 'aa-dot-red' : 'aa-dot-amber'}"></span>
              Row ${a.row} · ${a.z > 0 ? '+' : ''}${a.z}σ deviation
            </div>`
          ).join('')}
        </div>
      </div>
    </div>

    <div class="aa-grid-2 aa-mt">
      <div class="aa-card">
        <div class="aa-card-label">TREND · ${(mainCol || 'col').toUpperCase()}</div>
        <div class="aa-chart">${_sparkSVG(monthly.length ? monthly : (data.sparkline ?? []), 190, 52)}</div>
        ${barVals.length ? `<div class="aa-bar-list">
          ${barVals.map(v => `
            <div class="aa-bar-row">
              <span>${v.label}</span>
              <div class="aa-bar-track"><div class="aa-bar-fill aa-fill-blue" style="width:${(v.ratio*100).toFixed(0)}%"></div></div>
              <span>${(v.ratio*100).toFixed(0)}%</span>
            </div>`).join('')}
        </div>` : ''}
      </div>
      <div class="aa-card">
        <div class="aa-card-label">AI INSIGHTS</div>
        <div class="aa-insights">
          ${insights.map((s,i) => `<div class="aa-insight"><span class="aa-insight-n">${i+1}</span>${s}</div>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function _buildStock(data, body) {
  const nulls    = data.null_per_col ?? {};
  const total    = data.shape ? data.shape[0] : 1;
  const cols     = data.all_cols ?? Object.keys(nulls);
  const desc     = data.describe ?? {};
  const numCols  = data.numeric_cols ?? [];

  // Data quality score
  const totalNulls   = data.nulls ?? 0;
  const totalCells   = total * (data.shape?.[1] ?? 1) || 1;
  const qualityScore = Math.round(((totalCells - totalNulls) / totalCells) * 100);
  const healthColor  = qualityScore >= 95 ? 'aa-green' : qualityScore >= 80 ? 'aa-amber' : 'aa-red';

  // Column health entries
  const colRows = cols.map(c => {
    const n      = nulls[c] ?? 0;
    const pct    = (n / total) * 100;
    const clr    = pct === 0 ? '#4ade80' : pct < 5 ? '#fbbf24' : '#f87171';
    const health = pct === 0 ? '● GOOD' : pct < 5 ? '⚠ WARN' : '✗ POOR';
    const hcls   = pct === 0 ? 'aa-green' : pct < 5 ? 'aa-amber' : 'aa-red';
    const fill   = Math.max(2, 100 - pct);
    return `<div class="aa-col-row">
      <span class="aa-col-name">${c}</span>
      <div class="aa-bar-track"><div class="aa-bar-fill" style="width:${fill.toFixed(0)}%;background:${clr}"></div></div>
      <span class="aa-col-stat ${hcls}">${n === 0 ? '0 nulls' : n + ' null'}</span>
    </div>`;
  }).join('');

  // Stats for numeric columns
  const numRows = numCols.map(c => {
    const d = desc[c]; if (!d) return '';
    const range = d.max - d.min || 1;
    const q1fill = ((d.q25 - d.min) / range * 100).toFixed(0);
    const q3fill = ((d.q75 - d.min) / range * 100).toFixed(0);
    return `<div class="aa-stat-row">
      <span class="aa-col-name">${c}</span>
      <span class="aa-stat-val">${_fmt(d.mean)}</span>
      <div class="aa-bar-track">
        <div class="aa-bar-fill aa-fill-blue" style="width:${q3fill}%;opacity:0.3"></div>
        <div class="aa-bar-fill aa-fill-blue aa-bar-q1" style="width:${q1fill}%"></div>
      </div>
      <span class="aa-stat-range">[${_fmt(d.min)} – ${_fmt(d.max)}]</span>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="aa-grid-2">
      <div class="aa-card">
        <div class="aa-card-label">DATA QUALITY SCORE</div>
        <div class="aa-card-main ${healthColor}">${qualityScore}%</div>
        <div class="aa-card-sub">${totalNulls} null${totalNulls !== 1 ? 's' : ''} of ${totalCells.toLocaleString()} cells</div>
        <div class="aa-bar-track aa-mt-sm"><div class="aa-bar-fill" style="width:${qualityScore}%;background:${qualityScore>=95?'#4ade80':qualityScore>=80?'#fbbf24':'#f87171'}"></div></div>
      </div>
      <div class="aa-card">
        <div class="aa-card-label">SHAPE</div>
        <div class="aa-two-stat">
          <div><div class="aa-stat-big aa-blue">${(data.shape?.[0] ?? 0).toLocaleString()}</div><div class="aa-stat-lbl">rows</div></div>
          <div><div class="aa-stat-big aa-cyan">${data.shape?.[1] ?? 0}</div><div class="aa-stat-lbl">columns</div></div>
          <div><div class="aa-stat-big aa-amber">${data.memory ?? '—'}</div><div class="aa-stat-lbl">MB</div></div>
        </div>
      </div>
    </div>

    <div class="aa-card aa-mt">
      <div class="aa-card-label">COLUMN NULL INVENTORY</div>
      ${colRows || '<div class="aa-empty">No column data available</div>'}
    </div>

    <div class="aa-card aa-mt">
      <div class="aa-card-label">NUMERIC DISTRIBUTION (Q1 – Q3 band)</div>
      ${numRows || '<div class="aa-empty">No numeric columns</div>'}
    </div>
  `;
}

function _buildTrends(data, body) {
  const desc    = data.describe ?? {};
  const cols    = Object.keys(desc);
  const mainCol = cols[0];
  const d       = mainCol ? desc[mainCol] : null;
  const corr    = data.corr ?? {};

  // Growth scenarios from mean ± std
  let scenarios = '';
  if (d) {
    const base  = d.mean, sd = d.std;
    const bull  = base + sd;
    const bear  = Math.max(0, base - sd);
    const maxV  = bull || 1;
    scenarios = `
      <div class="aa-scenario-row">
        <span class="aa-sce-label aa-green">Optimistic</span>
        <div class="aa-bar-track"><div class="aa-bar-fill aa-fill-green" style="width:${(bull/maxV*100).toFixed(0)}%"></div></div>
        <span class="aa-sce-val aa-green">${_fmt(bull)}</span>
      </div>
      <div class="aa-scenario-row">
        <span class="aa-sce-label">Baseline</span>
        <div class="aa-bar-track"><div class="aa-bar-fill aa-fill-blue" style="width:${(base/maxV*100).toFixed(0)}%"></div></div>
        <span class="aa-sce-val">${_fmt(base)}</span>
      </div>
      <div class="aa-scenario-row">
        <span class="aa-sce-label aa-red">Pessimistic</span>
        <div class="aa-bar-track"><div class="aa-bar-fill aa-fill-red" style="width:${(bear/maxV*100).toFixed(0)}%"></div></div>
        <span class="aa-sce-val aa-red">${_fmt(bear)}</span>
      </div>`;
  }

  // Column sparklines
  const colSparks = cols.slice(0, 4).map(c => {
    const d2 = desc[c];
    const range = d2.max - d2.min || 1;
    const pts = [d2.min, d2.q25, d2.mean - d2.std * 0.5, d2.mean, d2.mean + d2.std * 0.5, d2.q75, d2.max]
      .map(v => (v - d2.min) / range);
    const colors = ['#6366f1','#67e8f9','#4ade80','#fbbf24'];
    const ci = cols.indexOf(c) % 4;
    return `<div class="aa-spark-row">
      <span class="aa-col-name">${c}</span>
      ${_sparkSVG(pts, 100, 24, colors[ci])}
      <span class="aa-stat-range">${_fmt(d2.min)}–${_fmt(d2.max)}</span>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="aa-grid-2">
      <div class="aa-card">
        <div class="aa-card-label">GROWTH SCENARIOS · ${(mainCol || '—').toUpperCase()}</div>
        ${scenarios || '<div class="aa-empty">No numeric column found</div>'}
      </div>
      <div class="aa-card">
        <div class="aa-card-label">COLUMN TRENDS</div>
        ${colSparks || '<div class="aa-empty">No data</div>'}
      </div>
    </div>
    <div class="aa-card aa-mt">
      <div class="aa-card-label">CORRELATION MATRIX</div>
      <div class="aa-corr-wrap">
        ${Object.keys(corr).length >= 2 ? _corrHeatmapSVG(corr) : '<div class="aa-empty">Need ≥2 numeric columns</div>'}
        ${Object.keys(corr).length >= 2 ? `<div class="aa-corr-legend">
          <span style="color:#818cf8">■ positive</span>
          <span style="color:#f87171;margin-left:10px">■ negative</span>
        </div>` : ''}
      </div>
    </div>
  `;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates the analytics panel DOM (hidden initially).
 * Returns { el, update(data) }.
 */
export function createAnalyticsPanel() {
  const panel = document.createElement('div');
  panel.className  = 'aria-analytics';
  panel.style.display = 'none';

  panel.innerHTML = `
    <div class="aa-header">
      <div class="aa-df-info">
        <span class="aa-ar-badge">AR</span>
        <span class="aa-title">ARIA Analytics</span>
        <span class="aa-dot-live"></span>
        <span class="aa-df-badge" id="aa-df-badge">—</span>
      </div>
      <div class="aa-tabs">
        <button class="aa-tab aa-tab--active" data-tab="revenue">Revenue</button>
        <button class="aa-tab" data-tab="stock">Stock</button>
        <button class="aa-tab" data-tab="trends">Trends</button>
      </div>
    </div>
    <div class="aa-body" id="aa-body"></div>
  `;

  let _data = null;
  let _tab  = 'revenue';
  const body = panel.querySelector('#aa-body');

  function _render() {
    if (!_data) return;
    if (_tab === 'revenue') _buildRevenue(_data, body);
    if (_tab === 'stock')   _buildStock(_data, body);
    if (_tab === 'trends')  _buildTrends(_data, body);
  }

  panel.querySelectorAll('.aa-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.aa-tab').forEach(b => b.classList.remove('aa-tab--active'));
      btn.classList.add('aa-tab--active');
      _tab = btn.dataset.tab;
      _render();
    });
  });

  return {
    el: panel,
    update(data) {
      _data = data;
      panel.style.display = '';
      const badge = panel.querySelector('#aa-df-badge');
      if (badge && data.shape) {
        badge.textContent = `${data.name ?? 'df'} · ${data.shape[0].toLocaleString()} rows · ${data.shape[1]} cols`;
      }
      _render();
    },
  };
}

/**
 * After a compile() call, check if a DataFrame is in the kernel and
 * return its extracted analytics data, or null if none found.
 */
export async function extractDataFrameStats() {
  try {
    const outputs = await compile(EXTRACT_PY, 'python');
    const textBlock = outputs.find(o => o.type === 'text');
    if (!textBlock?.content?.trim()) return null;
    const json = JSON.parse(textBlock.content.trim());
    return (json && json.shape) ? json : null;
  } catch { return null; }
}
