// ── Completion dictionary ──────────────────────────────────

const BASE = [
  // keywords
  'False','None','True','and','as','assert','async','await',
  'break','class','continue','def','del','elif','else','except',
  'finally','for','from','global','if','import','in','is',
  'lambda','nonlocal','not','or','pass','raise','return',
  'try','while','with','yield',
  // builtins
  'abs','all','any','bin','bool','bytearray','bytes','callable',
  'chr','classmethod','compile','complex','delattr','dict','dir',
  'divmod','enumerate','eval','exec','filter','float','format',
  'frozenset','getattr','globals','hasattr','hash','help','hex',
  'id','input','int','isinstance','issubclass','iter','len','list',
  'locals','map','max','min','next','object','oct','open','ord',
  'pow','print','property','range','repr','reversed','round','set',
  'setattr','slice','sorted','staticmethod','str','sum','super',
  'tuple','type','vars','zip',
  // common patterns
  'import numpy as np',
  'import pandas as pd',
  'import matplotlib.pyplot as plt',
  'from sympy import symbols, expand, factor, simplify, solve, diff, integrate, latex, pi, sqrt, Matrix',
  'import math','import os','import sys','import re','import json',
  'import datetime','import collections','import itertools','import functools',
  // numpy
  'np.array','np.zeros','np.ones','np.linspace','np.arange',
  'np.random.rand','np.random.randn','np.random.randint',
  'np.dot','np.sum','np.mean','np.std','np.max','np.min',
  'np.reshape','np.concatenate','np.vstack','np.hstack','np.stack',
  'np.sqrt','np.abs','np.exp','np.log','np.log2','np.log10',
  'np.sin','np.cos','np.tan','np.pi','np.inf','np.nan',
  'np.where','np.argmax','np.argmin','np.unique','np.sort',
  'np.polyfit','np.polyval','np.linalg.inv','np.linalg.eig',
  // pandas
  'pd.DataFrame','pd.Series','pd.read_csv','pd.read_excel',
  'pd.concat','pd.merge','pd.isna','pd.notna',
  // matplotlib
  'plt.plot','plt.scatter','plt.bar','plt.hist','plt.imshow',
  'plt.xlabel','plt.ylabel','plt.title','plt.legend','plt.show',
  'plt.figure','plt.subplot','plt.subplots','plt.tight_layout',
  'plt.savefig','plt.grid','plt.xlim','plt.ylim',
  'plt.xticks','plt.yticks','plt.colorbar',
  // sympy
  'symbols','expand','factor','simplify','solve','diff',
  'integrate','Matrix','latex','pi','sqrt','oo','I',
  'sin','cos','tan','exp','log','Rational','Float','Integer',
  'Sum','Product','Limit','series','trigsimp','apart','cancel',
  // math
  'math.sqrt','math.pi','math.e','math.floor','math.ceil',
  'math.log','math.log2','math.log10','math.sin','math.cos',
  'math.tan','math.factorial','math.gcd','math.inf',
];

// ── Scoring ────────────────────────────────────────────────

function score(item, query) {
  const q = query.toLowerCase();
  const s = item.toLowerCase();
  if (s === q)           return 100;
  if (s.startsWith(q))   return 80 - s.length;
  if (s.includes(q))     return 50;
  // fuzzy: all chars of q appear in order in s
  let qi = 0;
  for (let si = 0; si < s.length && qi < q.length; si++) {
    if (s[si] === q[qi]) qi++;
  }
  return qi === q.length ? 20 : -1;
}

function suggest(word) {
  if (!word || word.length < 1) return [];
  return BASE
    .map(item => ({ item, s: score(item, word) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map(x => x.item);
}

// ── Word extraction ────────────────────────────────────────

function wordAt(editor) {
  const text = editor.value;
  const pos  = editor.selectionStart;
  let start  = pos;
  while (start > 0 && /[a-zA-Z0-9_.]/.test(text[start - 1])) start--;
  return { word: text.slice(start, pos), start, end: pos };
}

// ── Guard: inside string or comment? ──────────────────────

function inStringOrComment(editor) {
  const text   = editor.value;
  const pos    = editor.selectionStart;
  const before = text.slice(0, pos);
  // naive check: count unescaped # → comment
  let inStr = false, strChar = '', i = 0;
  while (i < before.length) {
    const c = before[i];
    if (!inStr) {
      if (c === '#') return true;
      if (c === '"' || c === "'") {
        if (before.slice(i, i+3) === c.repeat(3)) { inStr = true; strChar = c.repeat(3); i += 3; continue; }
        inStr = true; strChar = c;
      }
    } else {
      if (before.slice(i, i + strChar.length) === strChar) { inStr = false; i += strChar.length; continue; }
      if (c === '\\') { i += 2; continue; }
    }
    i++;
  }
  return inStr;
}

// ── Factory ────────────────────────────────────────────────

export function create() {
  let _editor = null, _popup = null, _items = [], _sel = -1, _active = false;

  function _hide()    { if (!_popup) return; _popup.style.display = 'none'; _items = []; _sel = -1; }
  function _esc(s)    { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function _accept(item) {
    const { word, start, end } = wordAt(_editor);
    _editor.value = _editor.value.slice(0, start) + item + _editor.value.slice(end);
    _editor.selectionStart = _editor.selectionEnd = start + item.length;
    _editor.dispatchEvent(new Event('input', { bubbles: true }));
    _hide();
    _editor.focus();
  }

  function _hl(item) {
    const { word } = wordAt(_editor);
    if (!word) return _esc(item);
    const idx = item.toLowerCase().indexOf(word.toLowerCase());
    if (idx === -1) return _esc(item);
    return _esc(item.slice(0, idx))
      + `<mark class="pcc-match">${_esc(item.slice(idx, idx + word.length))}</mark>`
      + _esc(item.slice(idx + word.length));
  }

  function _setSelected(idx) {
    if (!_items.length) return;
    _sel = Math.max(0, Math.min(idx, _items.length - 1));
    [..._popup.children].forEach((el, i) => el.classList.toggle('pcc-selected', i === _sel));
    _popup.children[_sel]?.scrollIntoView({ block: 'nearest' });
  }

  function _render(suggestions, top, left) {
    _popup.innerHTML = '';
    _items = suggestions; _sel = -1;
    suggestions.forEach(item => {
      const li = document.createElement('div');
      li.className = 'pcc-item';
      li.innerHTML = `<span class="pcc-icon">${item.includes(' ') ? '⊞' : '◈'}</span><span class="pcc-text">${_hl(item)}</span>`;
      li.addEventListener('mousedown', e => { e.preventDefault(); _accept(item); });
      _popup.appendChild(li);
    });
    _popup.style.cssText += `display:block;top:${top}px;left:${left}px`;
    _setSelected(0);
  }

  function _caretPos() {
    const style  = getComputedStyle(_editor);
    const lineH  = parseFloat(style.lineHeight) || 20;
    const padTop = parseFloat(style.paddingTop)  || 0;
    const padL   = parseFloat(style.paddingLeft) || 0;
    const lines  = _editor.value.slice(0, _editor.selectionStart).split('\n');
    const charW  = parseFloat(style.fontSize) * 0.602;
    return {
      top:  padTop + lines.length * lineH - _editor.scrollTop,
      left: Math.min(padL + lines[lines.length - 1].length * charW - _editor.scrollLeft, _editor.clientWidth - 220),
    };
  }

  function _onInput() {
    if (inStringOrComment(_editor)) { _hide(); return; }
    const { word } = wordAt(_editor);
    if (!word) { _hide(); return; }
    const list = suggest(word);
    if (!list.length) { _hide(); return; }
    const { top, left } = _caretPos();
    _render(list, top, left);
  }

  function _onKeydown(e) {
    if (!_popup || _popup.style.display === 'none') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); _setSelected(_sel + 1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _setSelected(_sel - 1); return; }
    if (e.key === 'Tab' || e.key === 'Enter') {
      if (_sel >= 0 && _items[_sel]) { e.preventDefault(); _accept(_items[_sel]); }
      return;
    }
    if (e.key === 'Escape') { _hide(); return; }
  }

  function _onBlur() { setTimeout(_hide, 120); }

  return {
    init(editor, editorArea) {
      if (_active) return;
      _editor = editor;
      _popup = document.createElement('div');
      _popup.className = 'pcc-popup';
      _popup.style.display = 'none';
      editorArea.appendChild(_popup);
      editor.addEventListener('input',   _onInput);
      editor.addEventListener('keydown', _onKeydown);
      editor.addEventListener('blur',    _onBlur);
      _active = true;
    },
    destroy() {
      if (!_active) return;
      _editor.removeEventListener('input',   _onInput);
      _editor.removeEventListener('keydown', _onKeydown);
      _editor.removeEventListener('blur',    _onBlur);
      _popup.remove();
      _editor = null; _popup = null; _items = []; _sel = -1; _active = false;
    },
    isActive() { return _active; },
  };
}

// ── Singleton for single-cell view ────────────────────

const _s = create();
export const init     = (...a) => _s.init(...a);
export const destroy  = ()     => _s.destroy();
export const isActive = ()     => _s.isActive();
