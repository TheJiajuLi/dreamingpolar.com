const B = window.BASE ?? '';

// ── 文档目录树 ──────────────────────────────────────────────────────────────────
// group: 分组标题 (section header in sidebar)
// title: 显示名称
// dataFile: JSON 内容文件路径
// children: 子页面
// badge: 小徽章文字（如"新"）
export const PAGES = [
  {
    group: '快速开始',
    items: [
      {
        title: '5 分钟上手',
        dataFile: `${B}/content_pages/docs/quickstart/quickstart.json`,
      },
      {
        title: '导入数据',
        dataFile: `${B}/content_pages/docs/data/data_loading_guide.json`,
      },
    ],
  },
  {
    group: '核心功能',
    items: [
      {
        title: 'Power Notebook',
        children: [
          {
            title: 'Cell 类型与快捷键',
            dataFile: `${B}/content_pages/docs/notebook/notebook_guide.json`,
          },
          {
            title: '跨 Cell 变量共享',
            dataFile: `${B}/content_pages/docs/notebook/notebook_guide.json`,
          },
          {
            title: '文件管理',
            dataFile: `${B}/content_pages/docs/data/data_loading_guide.json`,
          },
        ],
      },
      {
        title: 'ARIA 智能助手',
        children: [
          {
            title: '提问技巧',
            dataFile: `${B}/content_pages/docs/aria/aria_reference.json`,
          },
          {
            title: '智能报告',
            dataFile: `${B}/content_pages/docs/aria/aria_reference.json`,
          },
        ],
      },
      {
        title: 'DP Grid',
        badge: '新',
        dataFile: `${B}/content_pages/docs/notebook/notebook_guide.json`,
      },
    ],
  },
  {
    group: '进阶',
    items: [
      {
        title: 'Python / pandas',
        dataFile: `${B}/content_pages/tutorials/python_with_mathematics/pandas/pandas_tutorials.json`,
      },
      {
        title: 'LaTeX / MathJax',
        dataFile: `${B}/content_pages/tutorials/python_with_mathematics/sympy/sympy_tutorials.json`,
      },
      {
        title: '数据可视化',
        dataFile: `${B}/content_pages/tutorials/python_with_mathematics/matplotlib/matplotlib_tutorials.json`,
      },
    ],
  },
];

// ── 扁平化页面列表（供 prev/next 导航） ─────────────────────────────────────────
function _flatten(items, group) {
  const result = [];
  for (const item of items) {
    if (item.dataFile) result.push({ ...item, group });
    if (item.children) result.push(..._flatten(item.children, group));
  }
  return result;
}

export const FLAT_PAGES = PAGES.flatMap(g => _flatten(g.items, g.group));
