const WEBSITE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Dreaming Polar',
  alternateName: '极梦 · Dreaming Polar',
  url: 'https://dreamingpolar.com/',
  description: '在浏览器中直接运行 Python、绘制图表，与 AI 助手实时协作。专为探索与研究设计的交互式科学计算平台。',
  inLanguage: ['zh-CN', 'en'],
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: 'https://dreamingpolar.com/#search?q={search_term_string}',
    },
    'query-input': 'required name=search_term_string',
  },
};

const NAV_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Dreaming Polar 功能导航',
  itemListElement: [
    {
      '@type': 'SiteNavigationElement',
      position: 1,
      name: 'Python 科学计算环境',
      description: '在浏览器中直接运行 Python，无需安装，支持 SymPy、Pandas、Matplotlib、NumPy',
      url: 'https://dreamingpolar.com/#coding',
    },
    {
      '@type': 'SiteNavigationElement',
      position: 2,
      name: 'AI 研究助手',
      description: '与 AI 实时协作，辅助数据分析、代码解释与科研探索',
      url: 'https://dreamingpolar.com/#ai-chat',
    },
    {
      '@type': 'SiteNavigationElement',
      position: 3,
      name: 'SymPy 符号计算教程',
      description: '学习使用 SymPy 进行代数化简、微积分与方程求解',
      url: 'https://dreamingpolar.com/#sympy',
    },
    {
      '@type': 'SiteNavigationElement',
      position: 4,
      name: 'Pandas 数据分析教程',
      description: '掌握 Pandas 进行数据清洗、聚合与分析',
      url: 'https://dreamingpolar.com/#pandas',
    },
    {
      '@type': 'SiteNavigationElement',
      position: 5,
      name: 'Matplotlib 数据可视化教程',
      description: '使用 Matplotlib 绘制精美图表，直接在浏览器中预览',
      url: 'https://dreamingpolar.com/#matplotlib',
    },
    {
      '@type': 'SiteNavigationElement',
      position: 6,
      name: '关于 Dreaming Polar',
      description: '了解 Dreaming Polar 平台的设计理念与核心功能',
      url: 'https://dreamingpolar.com/#about',
    },
  ],
};

function injectSchema(data) {
  const s = document.createElement('script');
  s.type = 'application/ld+json';
  s.textContent = JSON.stringify(data);
  document.head.appendChild(s);
}

injectSchema(WEBSITE_SCHEMA);
injectSchema(NAV_SCHEMA);
