export const PAGES = [
  {
    title: 'Tutorials',
    cardGrid: true,
    cards: [
      {
        title: 'SymPy',
        desc: '符号计算：求导、积分、方程求解',
        dataFile: `${window.BASE}/content_pages/tutorials/python_with_mathematics/sympy/sympy_tutorials.json`,
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 L8 6 L12 14 L16 10 L20 18"/><circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none"/></svg>`,
      },
      {
        title: 'Pandas',
        desc: '数据清洗、分析与 DataFrame 操作',
        dataFile: `${window.BASE}/content_pages/tutorials/python_with_mathematics/pandas/pandas_tutorials.json`,
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="3" rx="1"/><rect x="3" y="10" width="18" height="3" rx="1"/><rect x="3" y="16" width="18" height="3" rx="1"/><line x1="8" y1="4" x2="8" y2="19"/><line x1="16" y1="4" x2="16" y2="19"/></svg>`,
      },
      {
        title: 'Matplotlib',
        desc: '绘制折线图、散点图、热力图等',
        dataFile: `${window.BASE}/content_pages/tutorials/python_with_mathematics/matplotlib/matplotlib_tutorials.json`,
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,18 7,10 11,14 15,7 21,12"/><line x1="3" y1="18" x2="21" y2="18"/><line x1="3" y1="4" x2="3" y2="18"/></svg>`,
      },
    ],
  },
  {
    title: 'Apps',
    cardGrid: true,
    cards: [
      {
        title: 'ARIA Terminal',
        desc: 'AI 驱动的交互式终端，生成代码并接入 Notebook',
        dataFile: `${window.BASE}/content_pages/docs/aria/aria_reference.json`,
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="2.2"/><circle cx="5.5" cy="5.5" r="1.4"/><circle cx="18.5" cy="5.5" r="1.4"/><circle cx="5.5" cy="18.5" r="1.4"/><circle cx="18.5" cy="18.5" r="1.4"/><line x1="12" y1="9.8" x2="6.8" y2="6.8"/><line x1="12" y1="9.8" x2="17.2" y2="6.8"/><line x1="12" y1="14.2" x2="6.8" y2="17.2"/><line x1="12" y1="14.2" x2="17.2" y2="17.2"/></svg>`,
      },
      {
        title: 'Notebook Kernel',
        desc: '跨 Cell 共享状态，像真正的 Jupyter',
        dataFile: `${window.BASE}/content_pages/docs/notebook/notebook_guide.json`,
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><line x1="10" y1="6.5" x2="14" y2="6.5"/><line x1="6.5" y1="10" x2="6.5" y2="14"/><line x1="17.5" y1="10" x2="17.5" y2="14"/><line x1="10" y1="17.5" x2="14" y2="17.5"/></svg>`,
      },
      {
        title: 'Load Data',
        desc: '导入 Excel / CSV，自动转为 DataFrame',
        dataFile: `${window.BASE}/content_pages/docs/data/data_loading_guide.json`,
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v4c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 9v4c0 1.66 3.58 3 8 3s8-1.34 8-3V9"/><path d="M4 13v4c0 1.66 3.58 3 8 3s8-1.34 8-3v-4"/></svg>`,
      },
    ],
  },
];