import { renderMessageMarkdown } from './message-markdown.js';

const BASE = '/api/ext/tpl-studio';
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- 主题跟随宿主面板
try {
  const theme = window.parent !== window && window.parent.ElainaWebPanelTheme;
  if (theme) {
    theme.bind(document.documentElement, {
      variables: [],
      schemeAttributes: ['data-theme'],
      map: {
        '--host-bg': '--bg', '--host-bg2': '--bg2', '--host-bg3': '--bg3',
        '--host-float': '--bg-float', '--host-text': '--text', '--host-text2': '--text2',
        '--host-text3': '--text3', '--host-border': '--border', '--host-accent': '--accent',
        '--host-accent-hover': '--accent-hover', '--host-accent-light': '--accent-light',
        '--host-accent-soft': '--accent-soft', '--host-success': '--success',
        '--host-danger': '--danger', '--host-warning': '--warning', '--host-info': '--info',
      },
    });
  }
} catch (_) { /* 独立打开时忽略 */ }

// ---------------------------------------------------------------- 状态
const S = {
  meta: null,
  templates: [],
  bots: [],
  groups: [],
  current: null,          // 当前编辑中的模板（含 key）
  buttonMode: 'visual',   // visual | json
  jsonTab: 'yaml',
  lastBuild: null,
  dirty: false,
};

const PREVIEW_VARS = {
  user_id: '10001', userid: '10001', username: '示例用户', nickname: '示例用户',
  group_id: '20001', groupid: '20001', group_name: '示例交流群', member_count: '128',
  appid: '102130561', botid: '102130561', bot_name: 'Elaina', botname: 'Elaina',
  bot_qq: '10000', botqq: '10000', selfid: '10000',
  target_id: '10002', raw_user_id: '10002', member_id: '10002',
  time: '刚刚', reason: '想加入交流', error_message: '请求失败，请稍后重试',
  count: '3', minutes: '10',
};

// ---------------------------------------------------------------- 通用工具
function toast(msg, error = false) {
  const node = $('toast');
  node.textContent = msg;
  node.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.className = 'toast'; }, 2600);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(BASE + path, { ...options, headers, credentials: 'same-origin' });
  const raw = await res.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) { /* ignore */ }
  if (!res.ok || payload.success !== true) {
    const err = payload.error;
    throw new Error((err && typeof err === 'object' ? err.message : err) || `请求失败 (HTTP ${res.status})`);
  }
  return payload.data ?? {};
}

/** 用预览示例值替换 {变量}，双大括号保持字面量 */
function substitute(text, extra = {}) {
  const vars = { ...PREVIEW_VARS, ...extra };
  return String(text ?? '')
    .replace(/\{\{/g, '\u0000').replace(/\}\}/g, '\u0001')
    .replace(/\{([a-zA-Z_]\w*)\}/g, (token, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : token))
    .replace(/\u0000/g, '{').replace(/\u0001/g, '}');
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- 按钮数据结构
function normalizeRows(buttons) {
  if (buttons == null) return [];
  if (typeof buttons === 'string') {
    try { buttons = JSON.parse(buttons || '[]'); } catch (_) { return []; }
  }
  if (typeof buttons === 'object' && !Array.isArray(buttons)) {
    buttons = buttons.rows || buttons.buttons || [];
  }
  if (!Array.isArray(buttons)) return [];
  const rows = [];
  for (const row of buttons) {
    if (Array.isArray(row)) { if (row.length) rows.push(row.map(cleanBtn)); }
    else if (row && typeof row === 'object') rows.push([cleanBtn(row)]);
  }
  return rows;
}

function cleanBtn(b) {
  return b && typeof b === 'object' && !Array.isArray(b) ? { ...b } : { text: '', type: 2, data: '' };
}

function newButton() {
  return { text: '按钮', type: 2, data: '/指令', style: 1 };
}

// ---------------------------------------------------------------- 渲染：模板列表
function renderList() {
  const kw = $('list-search').value.trim().toLowerCase();
  const items = S.templates.filter((t) =>
    !kw || t.key.toLowerCase().includes(kw) || t.label.toLowerCase().includes(kw)
    || (t.category || '').toLowerCase().includes(kw));
  $('list-count').textContent = S.templates.length;
  const host = $('tpl-list');
  if (!items.length) {
    host.innerHTML = `<div class="empty">${S.templates.length ? '没有匹配的模板' : '还没有模板，点上面的「新建模板」'}</div>`;
    return;
  }
  host.replaceChildren();
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tpl-item' + (S.current && S.current.key === item.key ? ' active' : '');
    btn.innerHTML = `<span>${esc(item.label)}</span>`
      + `<small>${esc(item.category || '未分类')} · ${item.buttons} 按钮</small>`;
    btn.addEventListener('click', () => selectTemplate(item.key));
    host.append(btn);
  }
}

// ---------------------------------------------------------------- 渲染：变量与参考
function renderVariables() {
  const groups = new Map();
  for (const v of S.meta.variables) {
    const scope = v.scope || '其它';
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push(v);
  }
  const host = $('var-groups');
  host.replaceChildren();
  for (const [scope, items] of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'var-group';
    const title = document.createElement('div');
    title.className = 'var-group-title';
    title.textContent = scope;
    const list = document.createElement('div');
    list.className = 'var-items';
    for (const v of items) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'var-chip';
      const token = v.token.split(' / ')[0];
      chip.innerHTML = `<code>${esc(token)}</code><span>${esc(v.label)}</span>`;
      chip.addEventListener('click', () => insertAtCursor(token));
      chip.title = `${v.token} — ${v.label}`;
      list.append(chip);
    }
    wrap.append(title, list);
    host.append(wrap);
  }
}

function renderMdRef() {
  const host = $('md-ref');
  host.replaceChildren();
  for (const item of S.meta.markdown) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<code>${esc(item.syntax)}</code><span>${esc(item.desc)}</span>`;
    host.append(row);
  }
}

function renderFieldTable() {
  const host = $('fields-table');
  host.replaceChildren();
  const head = document.createElement('div');
  head.className = 'fr head';
  head.innerHTML = '<span>字段</span><span>类型</span><span>说明</span><span>默认 / 备注</span>';
  host.append(head);
  for (const f of S.meta.fields) {
    const row = document.createElement('div');
    row.className = 'fr';
    row.innerHTML = `<code>${esc(f.name)}</code><span class="type">${esc(f.type)}</span>`
      + `<span>${esc(f.desc)}</span><span class="dflt muted">${esc(f.default || '—')}</span>`;
    host.append(row);
  }
}

function renderPlatformNotes() {
  const host = $('platform-notes');
  host.replaceChildren();
  for (const item of S.meta.platform_notes || []) {
    const row = document.createElement('div');
    row.className = 'note';
    row.innerHTML = `<b>${esc(item.topic)}</b><span>${esc(item.note)}</span>`;
    host.append(row);
  }
}

// ---------------------------------------------------------------- 渲染：按钮编辑器
function renderButtonEditor() {
  const host = $('btn-visual');
  host.replaceChildren();
  const rows = normalizeRows(S.current.buttons);

  rows.forEach((row, ri) => {
    const box = document.createElement('div');
    box.className = 'kbd-row';

    const head = document.createElement('div');
    head.className = 'kbd-row-head';
    head.innerHTML = `<b>第 ${ri + 1} 行</b><span>${row.length} 个按钮</span><span class="grow"></span>`;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn tiny';
    addBtn.textContent = '+ 按钮';
    addBtn.addEventListener('click', () => {
      rows[ri].push(newButton());
      applyRows(rows);
    });
    const delRow = document.createElement('button');
    delRow.type = 'button';
    delRow.className = 'btn tiny danger';
    delRow.textContent = '删整行';
    delRow.addEventListener('click', () => {
      rows.splice(ri, 1);
      applyRows(rows);
    });
    head.append(addBtn, delRow);
    box.append(head);

    row.forEach((btn, bi) => {
      box.append(buildButtonCard(btn, rows, ri, bi));
    });
    host.append(box);
  });

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '还没有按钮。点右上「+ 新行」再加按钮，或直接切到 JSON 粘贴现成的键盘数组。';
    host.append(empty);
  }
}

function buildButtonCard(btn, rows, ri, bi) {
  const card = document.createElement('div');
  card.className = 'kbd-btn';

  const headRow = document.createElement('div');
  headRow.className = 'kbd-btn-head';
  const text = document.createElement('input');
  text.type = 'text';
  text.value = btn.text || '';
  text.placeholder = '按钮文字';
  text.addEventListener('input', () => { rows[ri][bi].text = text.value; applyRows(rows); });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn tiny danger';
  del.textContent = '删除';
  del.addEventListener('click', () => { rows[ri].splice(bi, 1); applyRows(rows); });
  headRow.append(text, del);
  card.append(headRow);

  const grid = document.createElement('div');
  grid.className = 'kbd-grid';

  const typeSel = document.createElement('select');
  for (const t of S.meta.button_types) {
    const o = document.createElement('option');
    o.value = String(t.value);
    o.textContent = `${t.value} · ${t.label}`;
    if (Number(btn.type ?? 2) === t.value) o.selected = true;
    typeSel.append(o);
  }
  typeSel.addEventListener('change', () => {
    rows[ri][bi].type = Number(typeSel.value);
    if (Number(typeSel.value) === 0) { delete rows[ri][bi].data; rows[ri][bi].link ||= 'https://'; }
    else { delete rows[ri][bi].link; rows[ri][bi].data ||= '/指令'; }
    applyRows(rows);
  });
  grid.append(fieldWrap('类型', typeSel));

  const data = document.createElement('input');
  data.type = 'text';
  data.value = btn.link || btn.data || '';
  data.placeholder = btn.link ? 'https://…' : '/指令 或 回调数据';
  data.addEventListener('input', () => {
    if (btn.link || Number(btn.type) === 0) rows[ri][bi].link = data.value;
    else rows[ri][bi].data = data.value;
    applyRows(rows);
  });
  grid.append(fieldWrap('数据 / 链接', data));

  const styleSel = document.createElement('select');
  for (const s of S.meta.button_styles) {
    const o = document.createElement('option');
    o.value = String(s.value);
    o.textContent = `${s.value} · ${s.label}`;
    if (Number(btn.style ?? 1) === s.value) o.selected = true;
    styleSel.append(o);
  }
  styleSel.addEventListener('change', () => { rows[ri][bi].style = Number(styleSel.value); applyRows(rows); });
  grid.append(fieldWrap('样式', styleSel));

  const groupId = document.createElement('input');
  groupId.type = 'text';
  groupId.value = btn.group_id || '';
  groupId.placeholder = '互斥组（可空）';
  groupId.addEventListener('input', () => {
    if (groupId.value) rows[ri][bi].group_id = groupId.value;
    else delete rows[ri][bi].group_id;
    applyRows(rows);
  });
  grid.append(fieldWrap('group_id', groupId));

  const modal = document.createElement('input');
  modal.type = 'text';
  modal.value = typeof btn.modal === 'string' ? btn.modal : '';
  modal.placeholder = '二次确认文案（可空）';
  modal.addEventListener('input', () => {
    if (modal.value) rows[ri][bi].modal = modal.value; else delete rows[ri][bi].modal;
    applyRows(rows);
  });
  grid.append(fieldWrap('modal', modal));

  const tips = document.createElement('input');
  tips.type = 'text';
  tips.value = btn.tips || '';
  tips.placeholder = '不支持时提示（可空）';
  tips.addEventListener('input', () => {
    if (tips.value) rows[ri][bi].tips = tips.value; else delete rows[ri][bi].tips;
    applyRows(rows);
  });
  grid.append(fieldWrap('tips', tips));

  const subscribe = document.createElement('input');
  subscribe.type = 'text';
  subscribe.value = typeof btn.subscribe === 'string' ? btn.subscribe : '';
  subscribe.placeholder = '订阅模板 ID（可空）';
  subscribe.addEventListener('input', () => {
    if (subscribe.value) rows[ri][bi].subscribe = subscribe.value; else delete rows[ri][bi].subscribe;
    applyRows(rows);
  });
  grid.append(fieldWrap('subscribe', subscribe));

  const show = document.createElement('input');
  show.type = 'text';
  show.value = btn.show || '';
  show.placeholder = '点击后显示的替代文字';
  show.addEventListener('input', () => {
    if (show.value) rows[ri][bi].show = show.value; else delete rows[ri][bi].show;
    applyRows(rows);
  });
  grid.append(fieldWrap('show', show));

  card.append(grid);

  const flags = document.createElement('div');
  flags.className = 'kbd-flags';
  for (const [key, label] of [['enter', '点击直发'], ['reply', '引用回复'], ['admin', '仅管理员']]) {
    const wrap = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!btn[key];
    cb.addEventListener('change', () => {
      if (cb.checked) rows[ri][bi][key] = true; else delete rows[ri][bi][key];
      applyRows(rows);
    });
    wrap.append(cb, document.createTextNode(label));
    flags.append(wrap);
  }
  card.append(flags);

  return card;
}

function fieldWrap(label, node) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, node);
  return wrap;
}

// ---------------------------------------------------------------- 表单 ↔ 状态

/** 把可视化编辑结果写回 S.current 并刷新预览与 JSON（不重建按钮编辑器，避免输入焦点丢失） */
function applyRows(rows) {
  S.current.buttons = rows;
  markDirty();
  refreshPreview();
  renderJson();
  scheduleBuild();  // 按钮结构变了，平台 keyboard 也要重新生成
}

function readForm() {
  const rows = S.current ? S.current.buttons : [];
  return {
    label: $('f-label').value.trim(),
    category: $('f-category').value.trim(),
    content: $('f-content').value,
    buttons: rows,
    msg_type: Number($('f-msg-type').value || 2),
    small_buttons: $('f-small').checked,
    at_user: $('f-at-user').checked,
  };
}

function markDirty(dirty = true) {
  S.dirty = dirty;
  $('btn-save').disabled = !S.current;
  $('editor-title').textContent = (S.current?.label || '未命名模板') + (dirty ? ' *' : '');
}

// ---------------------------------------------------------------- 预览
function renderKeyboard(buttons) {
  const host = $('preview-keyboard');
  host.replaceChildren();
  const rows = normalizeRows(buttons);
  host.classList.toggle('small', !!$('f-small').checked);
  if (!rows.length) { host.hidden = true; return; }
  host.hidden = false;
  const styleClass = ['gray', '', 'black', 'red', 'fill'];  // 0灰框 1蓝框 2黑框 3红字 4蓝底
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'kbd-line';
    for (const btn of row) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'key ' + (styleClass[Number(btn.style ?? 1)] ?? '');
      const isLink = !!btn.link || Number(btn.type) === 0;
      b.textContent = substitute(btn.text || (btn.render_data || {}).label || '未命名') + (isLink ? ' ↗' : '');
      b.title = substitute(btn.link || btn.data || '') || '仅预览';
      line.append(b);
    }
    host.append(line);
  }
}

function refreshPreview() {
  if (!S.current) return;
  const form = readForm();
  let content = substitute(form.content);
  if (form.at_user) content = `<@${PREVIEW_VARS.user_id}> ${content}`;
  const node = $('preview-content');
  if (!String(content).trim()) {
    node.className = 'message-markdown';
    node.innerHTML = '<span class="muted">在左侧输入正文，这里会同步显示 QQ 里的样子</span>';
  } else if (Number(form.msg_type) === 0) {
    node.className = 'message-markdown';
    node.textContent = content;
  } else {
    node.className = 'message-markdown';
    node.innerHTML = renderMessageMarkdown(content, {
      [PREVIEW_VARS.user_id]: PREVIEW_VARS.username,
      [PREVIEW_VARS.target_id]: '示例成员',
    });
  }
  renderKeyboard(form.buttons);
  $('preview-date').textContent = form.label || '模板预览';
  $('preview-bot').textContent = S.meta?.default_bot?.name || 'Elaina';
}

function renderHints(result) {
  const warnHost = $('preview-warn');
  warnHost.replaceChildren();
  if (!result) { warnHost.hidden = true; return; }
  const lines = [...(result.errors || []).map((e) => ['error', e]), ...(result.warnings || []).map((w) => ['warn', w])];
  if (!lines.length) { warnHost.hidden = true; return; }
  warnHost.hidden = false;
  for (const [kind, text] of lines.slice(0, 12)) {
    const div = document.createElement('div');
    div.textContent = (kind === 'error' ? '✗ ' : '! ') + text;
    warnHost.append(div);
  }
  const ch = $('content-hints');
  ch.replaceChildren();
  for (const w of (result.markdown?.warnings || []).slice(0, 6)) {
    const d = document.createElement('div');
    d.className = 'hint';
    d.textContent = w;
    ch.append(d);
  }
  const bh = $('button-hints');
  bh.replaceChildren();
  for (const e of (result.errors || []).slice(0, 6)) {
    const d = document.createElement('div');
    d.className = 'hint';
    const b = document.createElement('b');
    b.textContent = e;
    d.append(b);
    bh.append(d);
  }
  if (result.stats) {
    const d = document.createElement('div');
    d.className = 'hint';
    d.textContent = `${result.stats.buttons} 个按钮 / ${result.stats.rows} 行 · 正文 ${result.stats.content_length} 字`
      + (result.stats.variables.length ? ` · 变量 ${result.stats.variables.join(', ')}` : '');
    bh.append(d);
  }
}

function buildJsonVariants(result) {
  const form = readForm();
  const rows = normalizeRows(form.buttons);
  // templates.yaml 片段 / 插件存储 / payload 三份都直接用当前表单，保证和编辑器完全一致
  const frameworkJson = { content: form.content };
  if (rows.length) frameworkJson.buttons = rows;

  const pluginRecord = {
    label: form.label || S.current.key,
    category: form.category,
    updated: new Date().toISOString().slice(0, 19).replace('T', ' '),
    content: form.content,
    buttons: rows,
    msg_type: form.msg_type,
    small_buttons: form.small_buttons,
    at_user: form.at_user,
    button_font_size: form.small_buttons ? 'small' : '',
  };

  const payload = { msg_type: form.msg_type };
  if (form.msg_type === 2) payload.markdown = { content: form.content };
  else payload.content = form.content;
  if (result?.platform_keyboard) payload.keyboard = result.platform_keyboard;
  if (form.small_buttons) payload.button_font_size = 'small';

  return {
    yaml: { [S.current.key]: frameworkJson },
    platform: result?.platform_keyboard || { note: rows.length ? '正在生成…' : '该模板没有按钮' },
    plugin: { [S.current.key]: pluginRecord },
    payload,
  };
}

function renderJson() {
  if (!S.current) return;
  const variants = buildJsonVariants(S.lastBuild);
  const value = variants[S.jsonTab];
  $('json-out').value = value === undefined ? '' : JSON.stringify(value, null, 2);
}

// ---------------------------------------------------------------- 构建（调后端 validate）
let buildTimer;
function scheduleBuild() {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(runBuild, 350);
}

async function runBuild() {
  if (!S.current) return;
  const form = readForm();
  try {
    S.lastBuild = await api('/build', { method: 'POST', body: JSON.stringify(form) });
    renderHints(S.lastBuild);
    refreshPreview();
    renderJson();
  } catch (e) {
    toast('校验失败: ' + e.message, true);
  }
}

// ---------------------------------------------------------------- 加载与选择

async function loadAll() {
  try {
    $('conn-state').textContent = '正在读取…';
    const [meta, list, bots, groups] = await Promise.all([
      api('/meta'), api('/templates'), api('/bots'), api('/groups'),
    ]);
    S.meta = meta;
    S.templates = list.templates || [];
    S.bots = bots.bots || [];
    S.groups = groups.groups || [];
    renderVariables();
    renderMdRef();
    renderFieldTable();
    renderPlatformNotes();
    renderList();
    renderGroupPicker();
    $('conn-state').textContent = '已连接';
    if (S.templates.length) selectTemplate(S.templates[0].key);
  } catch (e) {
    $('conn-state').textContent = '连接失败';
    toast(e.message, true);
  }
}

function renderGroupPicker() {
  const sel = $('f-group-pick');
  sel.replaceChildren();
  const o = document.createElement('option');
  o.value = '';
  o.textContent = '选择已有群';
  sel.append(o);
  // 有主动消息权限的群排前面，测试发送才不会撞 40034105
  const sorted = [...S.groups].sort((a, b) => Number(b.can_proactive) - Number(a.can_proactive));
  for (const g of sorted) {
    const opt = document.createElement('option');
    opt.value = g.group_id;
    const flag = g.can_proactive ? ' ✓主动' : '';
    opt.textContent = `${g.group_name || '群'} (${g.group_id})${flag}`;
    sel.append(opt);
  }
}

async function selectTemplate(key) {
  try {
    const { template } = await api('/template?key=' + encodeURIComponent(key));
    S.current = { key, ...template };
    S.current.buttons = normalizeRows(template.buttons);
    fillForm();
    renderList();
    renderButtonEditor();
    $('editor-body').hidden = false;
    $('empty-state').hidden = true;
    $('btn-delete').disabled = false;
    $('btn-duplicate').disabled = false;
    $('btn-save').disabled = false;
    $('btn-test-send').disabled = false;
    markDirty(false);
    $('editor-key').textContent = `键：${key} · ${template.category || '未分类'} · 存于 tpl_studio/data/templates.json`;
    await runBuild();
  } catch (e) {
    toast(e.message, true);
  }
}

function fillForm() {
  const t = S.current;
  $('f-key').value = t.key;
  $('f-label').value = t.label || '';
  $('f-category').value = t.category || '';
  $('f-content').value = typeof t.content === 'string' ? t.content : '';
  $('f-msg-type').value = String(t.msg_type ?? 2);
  $('f-small').checked = !!t.small_buttons;
  $('f-at-user').checked = !!t.at_user;
  $('f-buttons').value = JSON.stringify(t.buttons || [], null, 2);
  $('f-buttons').hidden = S.buttonMode !== 'json';
  $('btn-visual').hidden = S.buttonMode === 'json';
  $('btn-mode').textContent = S.buttonMode === 'json' ? '切到可视化' : '切到 JSON';
}

function newTemplate() {
  const key = 'template-' + Date.now().toString(36);
  S.current = {
    key,
    label: '新模板',
    category: '',
    content: '**新模板**\n\n> 在这里写正文，{user_id} 这类变量发送时会被框架替换',
    buttons: [[{ text: '按钮一', data: '/指令', type: 2, style: 1 }]],
    msg_type: 2,
    small_buttons: false,
    at_user: false,
  };
  fillForm();
  renderButtonEditor();
  $('editor-body').hidden = false;
  $('empty-state').hidden = true;
  $('btn-save').disabled = false;
  $('btn-delete').disabled = true;
  $('btn-duplicate').disabled = false;
  $('btn-test-send').disabled = false;
  markDirty(true);
  $('editor-key').textContent = '尚未保存，填写键后点「保存模板」';
  runBuild();
}

function insertAtCursor(text) {
  const areas = [$('f-content'), $('f-buttons'), $('json-in')].filter((a) => !a.hidden);
  const target = areas.find((a) => a === document.activeElement) || $('f-content');
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  target.value = target.value.slice(0, start) + text + target.value.slice(end);
  target.selectionStart = target.selectionEnd = start + text.length;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.focus();
}

// ---------------------------------------------------------------- 保存 / 删除 / 复制

async function saveTemplate() {
  if (!S.current) return;
  const key = $('f-key').value.trim();
  if (!key) { toast('模板键不能为空', true); return; }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) { toast('模板键只能用字母、数字、下划线、连字符', true); return; }
  const form = readForm();
  const rows = normalizeRows(form.buttons);
  try {
    const data = await api('/template', {
      method: 'POST',
      body: JSON.stringify({
        key, label: form.label, category: form.category,
        template: {
          content: form.content,
          buttons: rows,
          msg_type: form.msg_type,
          small_buttons: form.small_buttons,
          at_user: form.at_user,
          button_font_size: form.small_buttons ? 'small' : '',
        },
      }),
    });
    S.current = { key, ...data.template };
    S.current.buttons = normalizeRows(data.template.buttons);
    toast('已保存 ' + key);
    await loadAll();
    selectTemplate(key);
    markDirty(false);
  } catch (e) {
    toast('保存失败: ' + e.message, true);
  }
}

async function deleteTemplate() {
  if (!S.current) return;
  if (!confirm(`删除模板 ${S.current.key}？此操作不可撤销。`)) return;
  try {
    await api('/template?key=' + encodeURIComponent(S.current.key), { method: 'DELETE' });
    toast('已删除 ' + S.current.key);
    S.current = null;
    $('editor-body').hidden = true;
    $('empty-state').hidden = false;
    $('editor-title').textContent = '未选择模板';
    $('editor-key').textContent = '从左侧选择一个模板，或点击「新建模板」';
    $('btn-save').disabled = true;
    $('btn-delete').disabled = true;
    $('btn-duplicate').disabled = true;
    $('btn-test-send').disabled = true;
    $('preview-content').innerHTML = '';
    $('preview-keyboard').hidden = true;
    await loadAll();
  } catch (e) {
    toast('删除失败: ' + e.message, true);
  }
}

async function duplicateTemplate() {
  if (!S.current) return;
  const key = S.current.key + '-copy-' + Date.now().toString(36).slice(-4);
  const form = readForm();
  try {
    await api('/template', {
      method: 'POST',
      body: JSON.stringify({
        key, label: (form.label || key) + '（副本）', category: form.category,
        template: { content: form.content, buttons: form.buttons, msg_type: form.msg_type, small_buttons: form.small_buttons, at_user: form.at_user },
      }),
    });
    toast('已复制为 ' + key);
    await loadAll();
    selectTemplate(key);
  } catch (e) {
    toast('复制失败: ' + e.message, true);
  }
}

async function testSend() {
  if (!S.current) return;
  const groupId = $('f-test-group').value.trim() || $('f-group-pick').value;
  if (!groupId) { toast('先填写或选择一个群 ID', true); return; }
  const form = readForm();
  try {
    $('btn-test-send').disabled = true;
    const data = await api('/send', {
      method: 'POST',
      body: JSON.stringify({
        group_id: groupId,
        template: { content: form.content, buttons: form.buttons, msg_type: form.msg_type, button_font_size: form.small_buttons ? 'small' : '' },
      }),
    });
    toast('已发送到群 ' + groupId);
    if (data.response && data.response.code) toast(`平台返回 code=${data.response.code} ${data.response.message || ''}`, true);
  } catch (e) {
    toast('发送失败: ' + e.message, true);
  } finally {
    $('btn-test-send').disabled = false;
  }
}

// ---------------------------------------------------------------- 导入 / 导出

function openModal(title, bodyNode, actions) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.addEventListener('click', () => modal.remove());
  const dlg = document.createElement('div');
  dlg.className = 'modal-dialog';
  const head = document.createElement('div');
  head.className = 'modal-head';
  const h = document.createElement('h2');
  h.textContent = title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn tiny';
  close.textContent = '关闭';
  close.addEventListener('click', () => modal.remove());
  head.append(h, close);
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.append(bodyNode);
  dlg.append(head, body);
  if (actions) {
    const foot = document.createElement('div');
    foot.className = 'modal-head';
    foot.style.borderBottom = '0';
    foot.style.borderTop = '1px solid var(--line)';
    for (const a of actions) foot.append(a);
    dlg.append(foot);
  }
  modal.append(back, dlg);
  document.body.append(modal);
  return modal;
}

async function exportAll() {
  try {
    const data = await api('/export?format=plugin');
    const area = document.createElement('textarea');
    area.rows = 18;
    area.value = JSON.stringify(data.templates, null, 2);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn primary';
    copy.textContent = '复制全部';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(area.value).catch(() => area.select());
      toast('已复制');
    });
    openModal('导出全部模板', area, [copy]);
  } catch (e) { toast(e.message, true); }
}

async function importTemplates() {
  const area = document.createElement('textarea');
  area.rows = 16;
  area.placeholder = '粘贴 {key: template} 对象，或 [{key, template}] 数组';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn primary';
  submit.textContent = '导入';
  const modal = openModal('导入模板', area, [submit]);
  submit.addEventListener('click', async () => {
    let payload;
    try { payload = JSON.parse(area.value); } catch (e) { toast('JSON 解析失败: ' + e.message, true); return; }
    try {
      const data = await api('/import', { method: 'POST', body: JSON.stringify({ templates: payload }) });
      toast(`导入 ${data.imported} 个${data.skipped.length ? '，跳过 ' + data.skipped.length : ''}`);
      modal.remove();
      await loadAll();
    } catch (e) { toast('导入失败: ' + e.message, true); }
  });
}

// ---------------------------------------------------------------- 事件绑定

for (const id of ['f-content', 'f-label', 'f-category', 'f-msg-type', 'f-small', 'f-at-user']) {
  $(id).addEventListener('input', () => { markDirty(); refreshPreview(); scheduleBuild(); });
  $(id).addEventListener('change', () => { markDirty(); refreshPreview(); scheduleBuild(); });
}

$('f-buttons').addEventListener('input', () => {
  try {
    S.current.buttons = normalizeRows(JSON.parse($('f-buttons').value || '[]'));
    markDirty();
    refreshPreview();
    scheduleBuild();
  } catch (e) {
    $('button-hints').textContent = 'JSON 解析失败: ' + e.message;
  }
});

$('btn-mode').addEventListener('click', () => {
  if (S.buttonMode === 'json') {
    try {
      S.current.buttons = normalizeRows(JSON.parse($('f-buttons').value || '[]'));
      S.buttonMode = 'visual';
      renderButtonEditor();
    } catch (e) { toast('JSON 无法解析: ' + e.message, true); return; }
  } else {
    $('f-buttons').value = JSON.stringify(S.current.buttons || [], null, 2);
    S.buttonMode = 'json';
  }
  $('f-buttons').hidden = S.buttonMode !== 'json';
  $('btn-visual').hidden = S.buttonMode === 'json';
  $('btn-mode').textContent = S.buttonMode === 'json' ? '切到可视化' : '切到 JSON';
});

$('btn-add-row').addEventListener('click', () => {
  if (!S.current) return;
  S.current.buttons = normalizeRows(S.current.buttons);
  S.current.buttons.push([newButton()]);
  S.buttonMode = 'visual';
  $('f-buttons').hidden = true;
  $('btn-visual').hidden = false;
  $('btn-mode').textContent = '切到 JSON';
  renderButtonEditor();
  applyRows(S.current.buttons);
});

$('btn-vars').addEventListener('click', () => {
  const drawer = $('var-drawer');
  drawer.hidden = !drawer.hidden;
  $('btn-vars').setAttribute('aria-expanded', String(!drawer.hidden));
});
$('btn-md-ref').addEventListener('click', () => { const r = $('md-ref'); r.hidden = !r.hidden; });

$('btn-new').addEventListener('click', newTemplate);
$('btn-save').addEventListener('click', saveTemplate);
$('btn-delete').addEventListener('click', deleteTemplate);
$('btn-duplicate').addEventListener('click', duplicateTemplate);
$('btn-test-send').addEventListener('click', testSend);
$('btn-import').addEventListener('click', importTemplates);
$('btn-export').addEventListener('click', exportAll);
$('list-search').addEventListener('input', renderList);
$('f-group-pick').addEventListener('change', () => {
  if ($('f-group-pick').value) $('f-test-group').value = $('f-group-pick').value;
});

for (const tab of document.querySelectorAll('.json-tabs button')) {
  tab.addEventListener('click', () => {
    S.jsonTab = tab.dataset.tab;
    document.querySelectorAll('.json-tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b === tab)));
    renderJson();
    $('json-in').hidden = true;
    $('btn-toggle-raw').textContent = '从 JSON 应用';
  });
}

$('btn-copy-json').addEventListener('click', async () => {
  const text = $('json-out').value;
  try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板'); }
  catch (_) { $('json-out').select(); document.execCommand('copy'); toast('已复制'); }
});

$('btn-toggle-raw').addEventListener('click', () => {
  const input = $('json-in');
  if (input.hidden) {
    input.value = $('json-out').value;
    input.hidden = false;
    $('btn-toggle-raw').textContent = '应用这份 JSON';
    return;
  }
  let parsed;
  try { parsed = JSON.parse(input.value); } catch (e) { toast('JSON 解析失败: ' + e.message, true); return; }
  applyJsonToForm(parsed);
  input.hidden = true;
  $('btn-toggle-raw').textContent = '从 JSON 应用';
});

function applyJsonToForm(parsed) {
  if (!S.current) { toast('先选一个模板', true); return; }
  let body = parsed;
  // 支持四种格式：templates.yaml 片段（单键）、插件存储、platform.keyboard、payload
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const keys = Object.keys(body);
    if (keys.length === 1 && keys[0] === S.current.key) body = body[keys[0]];
    else if ('content' in body || 'markdown' in body) body = body;
    else if ('rows' in body && body.rows?.[0]?.buttons) {
      body = { content: $('f-content').value, buttons: body.rows.map((r) => r.buttons.map(btn => simplifyPlatformButton(btn))) };
    }
  }
  if (!body || typeof body !== 'object') { toast('无法识别的 JSON 结构', true); return; }
  if (typeof body.content === 'string') $('f-content').value = body.content;
  if (body.markdown && typeof body.markdown.content === 'string') $('f-content').value = body.markdown.content;
  const srcButtons = body.buttons || (body.keyboard && body.keyboard.content && body.keyboard.content.rows);
  if (srcButtons) {
    S.current.buttons = normalizeRows(Array.isArray(srcButtons) && srcButtons[0]?.buttons
      ? srcButtons.map((r) => r.buttons.map(simplifyPlatformButton))
      : srcButtons);
    renderButtonEditor();
    $('f-buttons').value = JSON.stringify(S.current.buttons, null, 2);
  }
  if (body.msg_type !== undefined) $('f-msg-type').value = String(body.msg_type);
  else if (body.markdown !== undefined) $('f-msg-type').value = '2';
  if (body.small_buttons !== undefined) $('f-small').checked = !!body.small_buttons;
  if (body.at_user !== undefined) $('f-at-user').checked = !!body.at_user;
  if (body.label) $('f-label').value = body.label;
  if (body.category) $('f-category').value = body.category;
  markDirty();
  refreshPreview();
  runBuild();
  toast('已应用到表单');
}

/** 平台原生按钮 → 框架简写 */
function simplifyPlatformButton(b) {
  if (!b || typeof b !== 'object') return newButton();
  const render = b.render_data || {};
  const action = b.action || {};
  const out = { text: render.label || render.visited_label || b.text || '' };
  if (action.type === 0) out.link = action.data || '';
  else {
    out.type = Number(action.type ?? 2);
    out.data = action.data || '';
  }
  if (render.style !== undefined) out.style = Number(render.style);
  if (action.enter) out.enter = true;
  if (action.reply) out.reply = true;
  if (action.permission && action.permission.type === 1) out.admin = true;
  if (b.group_id) out.group_id = b.group_id;
  if (action.unsupport_tips) out.tips = action.unsupport_tips;
  if (action.modal) out.modal = typeof action.modal === 'string' ? action.modal : action.modal.content;
  return out;
}

// ---------------------------------------------------------------- 启动
loadAll();
