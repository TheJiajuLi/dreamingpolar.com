// ── Settings Panel ─────────────────────────────────────────────────────────────
// iOS-style settings with toggle switches. All settings backed by localStorage.
// Mounted inside the right bar alongside the file manager panel.

const SETTINGS_KEY = 'dp-settings';

const DEFAULTS = {
  cacheNotebookOutput:  true,   // persist output blocks across page refreshes
  cacheKernelData:      true,   // prewrite inject-store files to Pyodide FS at boot
  cacheRightBarState:   true,   // remember which panel (files/settings) was last open
  cacheAriaHistory:     true,   // persist ARIA chat history across page refreshes
  autoRunOnLoad:        false,  // auto run all cells once kernel boots on page load
  autoSwitchFiles:      false,  // auto-switch to file manager when cursor is on pd.read_csv line
  autoRunOnFileInsert:  true,   // auto-run cell after inserting file from file manager
  smartFileNavigation:  true,   // clicking an already-inserted file navigates to its cell
  // ── DP Grid ──────────────────────────────────────────────────────────────
  cacheGridState:       true,   // remember open datasets across page refreshes
  gridConfirmSync:      true,   // show confirm dialog before syncing edits to kernel
  // ── Notebook 文件 ────────────────────────────────────────────────────────
  saveFileRemoveCell:   true,   // remove cell from notebook after saving as file
};

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch { return { ...DEFAULTS }; }
}

function _save(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
}

// ── iOS Toggle ─────────────────────────────────────────────────────────────────
function _makeToggle(key, checked, onChange) {
  const label = document.createElement('label');
  label.className = 'dp-toggle';

  const input = document.createElement('input');
  input.type       = 'checkbox';
  input.checked    = checked;
  input.dataset.key = key;

  const track = document.createElement('span');
  track.className = 'dp-toggle-track';
  const thumb = document.createElement('span');
  thumb.className = 'dp-toggle-thumb';
  track.appendChild(thumb);

  label.append(input, track);
  label.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('change', () => onChange(input.checked));
  return label;
}

// ── Setting row ────────────────────────────────────────────────────────────────
function _makeRow(title, subtitle, key, settings, onChange) {
  const row = document.createElement('div');
  row.className = 'dp-setting-row';

  const text = document.createElement('div');
  text.className = 'dp-setting-text';
  const name = document.createElement('div');
  name.className = 'dp-setting-name';
  name.textContent = title;
  text.appendChild(name);
  if (subtitle) {
    const sub = document.createElement('div');
    sub.className = 'dp-setting-sub';
    sub.textContent = subtitle;
    text.appendChild(sub);
  }

  const toggle = _makeToggle(key, settings[key], checked => {
    settings[key] = checked;
    _save(settings);
    onChange?.(key, checked, settings);
  });

  row.append(text, toggle);
  return row;
}

// ── Cycle row (theme / font) ───────────────────────────────────────────────────
function _makeCycleRow(title, subtitle, getLabel, onCycle) {
  const row = document.createElement('div');
  row.className = 'dp-setting-row dp-setting-row--cycle';

  const text = document.createElement('div');
  text.className = 'dp-setting-text';
  const name = document.createElement('div');
  name.className = 'dp-setting-name';
  name.textContent = title;
  text.appendChild(name);
  if (subtitle) {
    const sub = document.createElement('div');
    sub.className = 'dp-setting-sub';
    sub.textContent = subtitle;
    text.appendChild(sub);
  }

  const valBtn = document.createElement('button');
  valBtn.className = 'dp-setting-cycle-btn';

  const _refresh = () => {
    valBtn.textContent = getLabel();
  };
  _refresh();

  valBtn.addEventListener('click', e => {
    e.stopPropagation();
    onCycle();
    _refresh();
  });

  // Re-sync if changed externally (e.g. from another Settings row)
  document.addEventListener('dp-theme-changed', _refresh);
  document.addEventListener('dp-font-changed',  _refresh);

  row.append(text, valBtn);
  return row;
}

// ── Section header ─────────────────────────────────────────────────────────────
function _makeSection(title) {
  const h = document.createElement('div');
  h.className = 'dp-setting-section';
  h.textContent = title;
  return h;
}

function _makeCard(...rows) {
  const card = document.createElement('div');
  card.className = 'dp-setting-card';
  rows.forEach((r, i) => {
    card.appendChild(r);
    if (i < rows.length - 1) {
      const sep = document.createElement('div');
      sep.className = 'dp-setting-sep';
      card.appendChild(sep);
    }
  });
  return card;
}

// ── Settings categories (iOS-style drill-down) ────────────────────────────────
const _CATEGORIES = [
  {
    id: 'appearance',
    label: '外观',
    icon: 'ti-palette',
    desc: '主题色、界面字体',
    rows: () => [
      _makeCycleRow('主题',   '点击切换：Light → Dark → Grey → Aurora',
        () => window._dpThemeLabel?.() ?? '—',
        () => window._dpCycleTheme?.()),
      _makeCycleRow('界面字体', '点击切换代码与正文字体',
        () => window._dpFontLabel?.()  ?? '—',
        () => window._dpCycleFont?.()),
    ],
  },
  {
    id: 'cache',
    label: '缓存',
    icon: 'ti-database',
    desc: '输出、历史记录、启动行为',
    rows: s => [
      _makeRow('Notebook 输出缓存', '刷新后自动恢复 Cell 输出，无需重新运行', 'cacheNotebookOutput', s),
      _makeRow('ARIA 对话历史', '刷新后保留与 ARIA 的聊天记录，最多保存最近 40 条', 'cacheAriaHistory', s),
      _makeRow('内核数据预载', '启动时将文件中心数据预写入 Python 运行环境', 'cacheKernelData', s),
      _makeRow('侧边栏状态记忆', '记住文件管理/设置面板的展开状态', 'cacheRightBarState', s),
      _makeRow('启动后自动运行全部 Cell', '内核就绪后自动执行所有 Cell，恢复变量和输出', 'autoRunOnLoad', s),
    ],
  },
  {
    id: 'interaction',
    label: '交互',
    icon: 'ti-cursor-text',
    desc: '文件插入、导航、自动切换',
    rows: s => [
      _makeRow('插入文件后自动运行', '从文件中心点击插入时，自动运行对应 Cell', 'autoRunOnFileInsert', s),
      _makeRow('文件智能导航', '已插入的文件点击后追踪跳转至对应 Cell，而非重复插入', 'smartFileNavigation', s),
      _makeRow('文件管理自动切换', '光标停在 pd.read_csv() 行时自动切换到文件管理', 'autoSwitchFiles', s),
    ],
  },
  {
    id: 'grid',
    label: 'DP Grid',
    icon: 'ti-table',
    desc: '数据集标签页、同步行为',
    rows: s => [
      _makeRow('记住打开的数据集', '刷新后自动恢复 Grid 中打开的数据集标签页', 'cacheGridState', s),
      _makeRow('同步前确认', '将编辑同步到内核前弹出确认对话框，防止误操作', 'gridConfirmSync', s),
    ],
  },
  {
    id: 'notebook-files',
    label: 'Notebook 文件',
    icon: 'ti-file-code',
    desc: 'Cell 文件化、保存行为',
    rows: s => [
      _makeRow('保存后移出 Cell 列表', '保存为文件后，Cell 从编辑区移出，进入左侧文件树', 'saveFileRemoveCell', s),
    ],
  },
];

// ── Main factory ───────────────────────────────────────────────────────────────
export function createSettingsPanel(onSettingChange) {
  const settings = getSettings();

  const panel = document.createElement('div');
  panel.className = 'dp-settings-panel';

  // ── Shared header ──────────────────────────────────────────────────────────
  const hdr = document.createElement('div');
  hdr.className = 'dp-settings-hdr';

  const backBtn = document.createElement('button');
  backBtn.className = 'rb-file-hdr-close dp-settings-back';
  backBtn.innerHTML = `<i class="ti ti-chevron-left"></i>`;
  backBtn.style.display = 'none';

  const hdrTitle = document.createElement('span');
  hdrTitle.className = 'dp-settings-hdr-title';
  hdrTitle.textContent = 'Settings';

  const hdrClose = document.createElement('button');
  hdrClose.className = 'rb-file-hdr-close';
  hdrClose.innerHTML = `<i class="ti ti-x"></i>`;
  hdrClose.style.marginLeft = 'auto';

  hdr.append(backBtn, hdrTitle, hdrClose);

  // ── Sliding track (200% wide: main list | detail view) ─────────────────────
  const track = document.createElement('div');
  track.className = 'dp-settings-track';

  const mainPane   = document.createElement('div');
  mainPane.className = 'dp-settings-pane dp-settings-body';

  const detailPane = document.createElement('div');
  detailPane.className = 'dp-settings-pane dp-settings-body';

  track.append(mainPane, detailPane);

  // ── Build main category list ───────────────────────────────────────────────
  const onChange = (key, val, s) => { onSettingChange?.(key, val, s); };

  _CATEGORIES.forEach(cat => {
    const row = document.createElement('button');
    row.className = 'dp-settings-cat-row';
    row.dataset.cat = cat.id;
    row.innerHTML =
      `<span class="dp-settings-cat-icon"><i class="ti ${cat.icon}"></i></span>` +
      `<span class="dp-settings-cat-text">` +
        `<span class="dp-setting-name">${cat.label}</span>` +
        `<span class="dp-setting-sub">${cat.desc}</span>` +
      `</span>` +
      `<i class="ti ti-chevron-right dp-settings-cat-arrow"></i>`;

    row.addEventListener('click', () => {
      // Populate detail pane
      detailPane.innerHTML = '';
      detailPane.appendChild(_makeSection(cat.label));
      detailPane.appendChild(_makeCard(...cat.rows(settings).map(r => {
        // wire onChange
        const toggle = r.querySelector('input[type="checkbox"]');
        if (toggle) {
          toggle.addEventListener('change', () => {
            settings[toggle.dataset.key] = toggle.checked;
            try { localStorage.setItem('dp-settings', JSON.stringify(settings)); } catch {}
            onChange(toggle.dataset.key, toggle.checked, settings);
          });
        }
        return r;
      })));

      // Slide to detail
      track.style.transform = 'translateX(-50%)';
      hdrTitle.textContent = cat.label;
      backBtn.style.display = '';
    });

    mainPane.appendChild(row);
  });

  // ── Back button ────────────────────────────────────────────────────────────
  backBtn.addEventListener('click', () => {
    track.style.transform = 'translateX(0)';
    hdrTitle.textContent = 'Settings';
    backBtn.style.display = 'none';
  });

  panel.append(hdr, track);
  return { panel, settings, hdrClose };
}

