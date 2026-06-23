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

// ── Main factory ───────────────────────────────────────────────────────────────
export function createSettingsPanel(onSettingChange) {
  const settings = getSettings();

  const panel = document.createElement('div');
  panel.className = 'dp-settings-panel';

  // ── Header ─────────────────────────────────────────────────────────────────
  const hdr = document.createElement('div');
  hdr.className = 'dp-settings-hdr';
  const hdrTitle = document.createElement('span');
  hdrTitle.className = 'dp-settings-hdr-title';
  hdrTitle.textContent = 'Settings';

  const hdrClose = document.createElement('button');
  hdrClose.className = 'rb-file-hdr-close';
  hdrClose.innerHTML = `<i class="ti ti-x"></i>`;
  hdrClose.style.marginLeft = 'auto';

  hdr.append(hdrTitle, hdrClose);

  // ── Body ───────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'dp-settings-body';

  const onChange = (key, val, s) => {
    onSettingChange?.(key, val, s);
  };

  // ── Cache section ──────────────────────────────────────────────────────────
  body.appendChild(_makeSection('缓存'));
  body.appendChild(_makeCard(
    _makeRow(
      'Notebook 输出缓存',
      '刷新后自动恢复 Cell 输出，无需重新运行',
      'cacheNotebookOutput', settings, onChange
    ),
    _makeRow(
      'ARIA 对话历史',
      '刷新后保留与 ARIA 的聊天记录，最多保存最近 40 条',
      'cacheAriaHistory', settings, onChange
    ),
    _makeRow(
      '内核数据预载',
      '启动时将文件中心数据预写入 Python 运行环境',
      'cacheKernelData', settings, onChange
    ),
    _makeRow(
      '侧边栏状态记忆',
      '记住文件管理/设置面板的展开状态',
      'cacheRightBarState', settings, onChange
    ),
    _makeRow(
      '启动后自动运行全部 Cell',
      '内核就绪后自动执行所有 Cell，恢复变量和输出（建议与"内核数据预载"配合使用）',
      'autoRunOnLoad', settings, onChange
    ),
  ));

  // ── Interaction section ────────────────────────────────────────────────────
  body.appendChild(_makeSection('交互'));
  body.appendChild(_makeCard(
    _makeRow(
      '插入文件后自动运行',
      '从文件中心点击插入时，自动运行对应 Cell',
      'autoRunOnFileInsert', settings, onChange
    ),
    _makeRow(
      '文件智能导航',
      '已插入的文件点击后追踪跳转至对应 Cell，而非重复插入',
      'smartFileNavigation', settings, onChange
    ),
    _makeRow(
      '文件管理自动切换',
      '光标停在 pd.read_csv() 行时自动切换到文件管理',
      'autoSwitchFiles', settings, onChange
    ),
  ));

  // ── DP Grid section ────────────────────────────────────────────────────────
  body.appendChild(_makeSection('DP Grid'));
  body.appendChild(_makeCard(
    _makeRow(
      '记住打开的数据集',
      '刷新后自动恢复 Grid 中打开的数据集标签页',
      'cacheGridState', settings, onChange
    ),
    _makeRow(
      '同步前确认',
      '将编辑同步到内核前弹出确认对话框，防止误操作',
      'gridConfirmSync', settings, onChange
    ),
  ));

  panel.append(hdr, body);
  return { panel, settings, hdrClose };
}
