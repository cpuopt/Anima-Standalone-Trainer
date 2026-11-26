(() => {
  const $ = id => document.getElementById(id);

  const state = {
    token: '',
    portal: null,
    view: 'gallery', // gallery | lora | params | dataset
    group: 'all',
    query: '',
    sort: 'default',
    selecting: false,
    selected: new Set(),
    anchorId: null,
    models: null,
    paramsData: null,
    datasetData: null,
    lbIndex: -1,
    lbInfo: true,
    lbMetaCache: new Map(),
    zoom: 1, fitZoom: 1, panX: 0, panY: 0, imgW: 0, imgH: 0
  };

  function esc(val) {
    return String(val ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes} B`;
  }

  let toastTimer;
  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function extractTokenFromUrlOrInput(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    const match = trimmed.match(/\/p\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    return trimmed;
  }

  function currentTokenFromLocation() {
    const m = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function apiJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `${res.status} ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function showGate(errorMsg = '') {
    $('appShell').classList.add('hidden');
    $('gateWrap').classList.remove('hidden');
    if (errorMsg) {
      $('gateErr').textContent = errorMsg;
      $('gateErr').classList.remove('hidden');
    } else {
      $('gateErr').classList.add('hidden');
    }
  }

  function showApp() {
    $('gateWrap').classList.add('hidden');
    $('appShell').classList.remove('hidden');
  }

  async function loadPortal(token) {
    state.token = token;
    try {
      const data = await apiJson(`/api/portal/${encodeURIComponent(token)}`);
      state.portal = data;
      state.models = null;
      state.paramsData = null;
      state.datasetData = null;

      // Sync view if permission was revoked
      const p = data.permissions;
      if (state.view === 'lora' && !p.downloadLora) state.view = 'gallery';
      if (state.view === 'params' && !p.viewParams) state.view = 'gallery';
      if (state.view === 'dataset' && !p.downloadDataset) state.view = 'gallery';

      // Prune stale selection
      const validIds = new Set(data.previews.map(i => i.id));
      state.selected = new Set([...state.selected].filter(id => validIds.has(id)));

      showApp();
      renderAll();
    } catch (err) {
      showGate(err.message || '访问链接无效或已失效');
    }
  }

  function getFilteredPreviews() {
    if (!state.portal) return [];
    const q = state.query.trim().toLowerCase();
    let list = state.portal.previews.filter(item => {
      if (state.group !== 'all' && item.group !== state.group) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q)
        || item.epoch.toLowerCase().includes(q)
        || item.group.toLowerCase().includes(q);
    });
    if (state.sort === 'newest') list = [...list].sort((a, b) => b.mtime - a.mtime);
    if (state.sort === 'oldest') list = [...list].sort((a, b) => a.mtime - b.mtime);
    return list;
  }

  function renderSidebar() {
    const data = state.portal;
    const p = data.permissions;
    const unlocked = data.stage === 'delivery';

    $('projectTitle').textContent = data.title || '未命名成果展厅';
    $('clientNameMeta').textContent = `客户：${data.clientName}`;
    if (data.note) {
      $('projectNote').textContent = data.note;
      $('projectNote').classList.remove('hidden');
    } else {
      $('projectNote').classList.add('hidden');
    }

    $('stageBox').classList.toggle('unlocked', unlocked);
    $('stageTitle').textContent = unlocked ? '阶段二 · 已授权交付期' : '阶段一 · 成果预览期';
    $('stageDesc').textContent = unlocked
      ? '训练师已为您开通对应交付权限，可查验参数、下载数据集或获取指定 LoRA 模型。'
      : '当前仅开放训练师精选预览图查看与下载。模型权重、训练参数与数据集均处于锁定隔离状态。';

    const groupCounts = new Map();
    for (const item of data.previews) {
      groupCounts.set(item.group, (groupCounts.get(item.group) || 0) + 1);
    }
    if (state.group !== 'all' && !groupCounts.has(state.group)) state.group = 'all';

    const groupNavItems = [
      { key: 'all', label: '全部预览图', count: data.previews.length },
      ...[...groupCounts.entries()].map(([key, count]) => ({ key, label: key, count }))
    ];
    $('groupNav').innerHTML = groupNavItems.map(g => `
      <button class="nav-btn ${state.view === 'gallery' && state.group === g.key ? 'active' : ''}" data-group="${esc(g.key)}">
        <span class="nav-left"><span>${esc(g.label)}</span></span>
        <span class="nav-count">${g.count}</span>
      </button>
    `).join('');

    const delivers = [
      { key: 'lora', label: '指定 LoRA 模型', enabled: p.downloadLora, badge: p.downloadLora ? '已授权' : '未授权' },
      { key: 'params', label: '训练参数配置', enabled: p.viewParams, badge: p.viewParams ? '可读' : '已隐藏' },
      { key: 'dataset', label: '数据集归档包', enabled: p.downloadDataset, badge: p.downloadDataset ? '可下载' : '未授权' }
    ];
    $('deliverNav').innerHTML = delivers.map(d => `
      <button class="nav-btn ${state.view === d.key ? 'active' : ''}" data-view="${d.key}" ${d.enabled ? '' : 'disabled'}>
        <span class="nav-left"><span>${esc(d.label)}</span></span>
        <span class="${d.enabled ? 'open-tag' : 'lock-tag'}">${d.badge}</span>
      </button>
    `).join('');

    $('permMatrix').innerHTML = `
      <span class="perm-k">预览图审片与下载</span><span class="perm-v on">OPEN</span>
      <span class="perm-k">指定 LoRA 模型</span><span class="perm-v ${p.downloadLora ? 'on' : 'off'}">${p.downloadLora ? 'GRANTED' : 'LOCKED'}</span>
      <span class="perm-k">训练参数只读</span><span class="perm-v ${p.viewParams ? 'on' : 'off'}">${p.viewParams ? 'GRANTED' : 'HIDDEN'}</span>
      <span class="perm-k">数据集归档下载</span><span class="perm-v ${p.downloadDataset ? 'on' : 'off'}">${p.downloadDataset ? 'GRANTED' : 'LOCKED'}</span>
    `;
  }

  function renderTopbar() {
    const isGal = state.view === 'gallery';
    $('searchInput').style.display = isGal ? '' : 'none';
    $('sortSelect').style.display = isGal ? '' : 'none';
    $('densityWrap').style.display = isGal ? '' : 'none';
    $('selectToggleBtn').style.display = isGal ? '' : 'none';
    $('selBar').style.display = (isGal && (state.selecting || state.selected.size > 0)) ? 'flex' : 'none';
    $('selCount').textContent = String(state.selected.size);
    $('selectToggleBtn').classList.toggle('active', state.selecting);
    $('selectToggleBtn').setAttribute('aria-pressed', String(state.selecting));
  }

  function renderCardsHtml(items) {
    return items.map(img => `
      <article class="shot-card ${state.selected.has(img.id) ? 'selected' : ''}" data-id="${esc(img.id)}" tabindex="0">
        <div class="shot-media">
          <img src="${esc(img.url)}" alt="${esc(img.name)}" loading="lazy" />
          <button class="shot-check" data-check="${esc(img.id)}" aria-label="选中 ${esc(img.name)}">${state.selected.has(img.id) ? '✓' : ''}</button>
          <a class="shot-dl" href="${esc(img.downloadUrl)}" download="${esc(img.name)}" title="下载原图" onclick="event.stopPropagation()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-5-5m5 5l5-5M5 20h14"/></svg>
          </a>
        </div>
        <div class="shot-foot">
          <span class="shot-name" title="${esc(img.name)}">${state.group === 'all' ? `${esc(img.group)} · ` : ''}${esc(img.name)}</span>
          <span class="shot-meta">${esc(img.epoch)}</span>
        </div>
      </article>
    `).join('');
  }

  async function renderContent() {
    const root = $('mainContent');
    if (state.view === 'gallery') {
      const list = getFilteredPreviews();
      $('viewTitle').textContent = state.group === 'all' ? '全部可见预览图' : state.group;
      $('viewCount').textContent = `${list.length} 张可见`;

      if (!list.length) {
        root.innerHTML = `<div class="empty-box">${state.query ? '没有匹配的预览图片。' : '训练师尚未发布可见预览图，请稍后刷新查看。'}</div>`;
        return;
      }
      if (state.group === 'all') {
        root.innerHTML = `<div class="gallery-grid ${state.selecting ? 'selecting' : ''}">${renderCardsHtml(list)}</div>`;
      } else {
        root.innerHTML = `
          <section class="group-block">
            <div class="group-head"><h3>${esc(state.group)}</h3><span>${list.length} 张</span></div>
            <div class="gallery-grid ${state.selecting ? 'selecting' : ''}">${renderCardsHtml(list)}</div>
          </section>
        `;
      }
      return;
    }

    if (state.view === 'lora') {
      $('viewTitle').textContent = '指定 LoRA 模型交付';
      $('viewCount').textContent = '加载中…';
      root.innerHTML = `<div class="empty-box">正在加载已授权模型列表…</div>`;
      try {
        const res = await apiJson(`/api/portal/${encodeURIComponent(state.token)}/models`);
        if (state.view !== 'lora') return;
        state.models = res.items || [];
        $('viewCount').textContent = `已授权 ${state.models.length} 个权重`;
        if (!state.models.length) {
          root.innerHTML = `<div class="empty-box">训练师已开启模型下载权限，但暂未指定具体模型文件，请联系训练师确认。</div>`;
          return;
        }
        const tokEnc = encodeURIComponent(state.token);
        root.innerHTML = `
          <div class="deliver-wrap">
            <div class="deliver-lead">
              <div>
                <h2>已授权下载的模型权重</h2>
                <p>以下权重文件由训练师为本次委托专门指定开放，其余训练检查点保持隔离。</p>
              </div>
              <span class="open-tag">AUTHORIZED WEIGHTS</span>
            </div>
            <div class="file-table-scroll">
              <table class="file-table">
                <thead>
                  <tr><th>模型文件名</th><th>轮次标识</th><th>大小</th><th>更新时间</th><th>操作</th></tr>
                </thead>
                <tbody>
                  ${state.models.map((m, i) => `
                    <tr>
                      <td><strong class="mono">${esc(m.name)}</strong>${i === 0 ? '<span class="rec-tag">主交付</span>' : ''}</td>
                      <td>${esc(m.label)}</td>
                      <td class="mono">${formatBytes(m.size)}</td>
                      <td class="mono">${m.mtime ? new Date(m.mtime).toLocaleString() : '—'}</td>
                      <td>
                        <div style="display:flex;gap:8px;">
                          <button class="btn" data-model-meta="${m.index}" ${m.ready ? '' : 'disabled'}>元数据</button>
                          ${m.ready
                            ? `<a class="btn primary" href="/api/portal/${tokEnc}/models/${m.index}/download" download="${esc(m.name)}">下载模型</a>`
                            : `<span class="lock-tag">文件保存中</span>`}
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      } catch (err) {
        root.innerHTML = `<div class="empty-box">${esc(err.message)}</div>`;
      }
      return;
    }

    if (state.view === 'params') {
      $('viewTitle').textContent = '训练参数配置（只读）';
      $('viewCount').textContent = '加载中…';
      root.innerHTML = `<div class="empty-box">正在加载训练参数配置…</div>`;
      try {
        const res = await apiJson(`/api/portal/${encodeURIComponent(state.token)}/params`);
        if (state.view !== 'params') return;
        state.paramsData = res;
        $('viewCount').textContent = `${res.architecture || 'Anima'} · 已脱敏本地路径`;
        root.innerHTML = `
          <div class="deliver-wrap">
            <div class="deliver-lead">
              <div>
                <h2>本任务训练参数归档</h2>
                <p>已由训练师授权只读查阅（已自动剥离宿主机本地磁盘路径）。</p>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn" id="copyParamsBtn">复制参数 TOML</button>
                <button class="btn primary" id="exportTomlBtn">下载脱敏 TOML</button>
              </div>
            </div>
            <div class="param-grid">
              ${(res.sections || []).map(sec => `
                <div class="param-card">
                  <h3>${esc(sec.title)}</h3>
                  <div class="kv-list">
                    ${(sec.items || []).map(([k, v]) => `<span class="kv-k">${esc(k)}</span><span class="kv-v">${esc(v)}</span>`).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
            <details class="param-card">
              <summary style="cursor:pointer;color:var(--text-2);font-size:13px;">查看完整脱敏配置原文 (TOML)</summary>
              <pre class="lb-pre" style="margin-top:12px;">${esc(res.toml || '')}</pre>
            </details>
          </div>
        `;
      } catch (err) {
        root.innerHTML = `<div class="empty-box">${esc(err.message)}</div>`;
      }
      return;
    }

    if (state.view === 'dataset') {
      $('viewTitle').textContent = '数据集归档下载';
      $('viewCount').textContent = '加载中…';
      root.innerHTML = `<div class="empty-box">正在统计数据集归档信息…</div>`;
      try {
        const res = await apiJson(`/api/portal/${encodeURIComponent(state.token)}/dataset`);
        if (state.view !== 'dataset') return;
        state.datasetData = res;
        $('viewCount').textContent = `${res.imageCount} 张图像 · ${formatBytes(res.totalBytes)}`;
        const tokEnc = encodeURIComponent(state.token);
        if (!res.available) {
          root.innerHTML = `<div class="empty-box">当前任务数据集目录不可用或为空，请联系训练师核查。</div>`;
          return;
        }
        root.innerHTML = `
          <div class="deliver-wrap">
            <div class="deliver-lead">
              <div>
                <h2>已授权数据集打包归档</h2>
                <p>包含全部训练图像及对应标注文本文件，下载时自动实时打包为标准 ZIP 归档。</p>
              </div>
              <a class="btn primary" href="/api/portal/${tokEnc}/dataset/download" download="dataset_archive.zip">下载数据集归档 (.zip)</a>
            </div>
            <div class="ds-metrics">
              <div class="ds-stat"><span>图像文件总数</span><strong>${res.imageCount}</strong></div>
              <div class="ds-stat"><span>标注文件数</span><strong>${res.captionCount}</strong></div>
              <div class="ds-stat"><span>标注覆盖率</span><strong>${res.captionCoverage}%</strong></div>
              <div class="ds-stat"><span>原始总体积</span><strong>${formatBytes(res.totalBytes)}</strong></div>
            </div>
            <div class="file-table-scroll">
              <table class="file-table">
                <thead><tr><th>归档内容</th><th>子集数量</th><th>图像格式</th><th>操作</th></tr></thead>
                <tbody>
                  <tr>
                    <td class="mono"><strong>dataset_archive.zip</strong></td>
                    <td class="mono">${res.subsetsCount} 个子集</td>
                    <td class="mono">${esc((res.formats || []).join(' / ') || '—')}</td>
                    <td><a class="btn primary" href="/api/portal/${tokEnc}/dataset/download" download="dataset_archive.zip">打包下载 (.zip)</a></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        `;
      } catch (err) {
        root.innerHTML = `<div class="empty-box">${esc(err.message)}</div>`;
      }
    }
  }

  function renderAll() {
    renderSidebar();
    renderTopbar();
    void renderContent();
  }

  /* 灯箱看图逻辑 */
  function applyTransform() {
    const img = $('lbImg');
    img.style.width = state.imgW + 'px';
    img.style.height = state.imgH + 'px';
    img.style.transform = `translate(${state.panX - state.imgW * state.zoom / 2}px, ${state.panY - state.imgH * state.zoom / 2}px) scale(${state.zoom})`;
    $('zoomPct').textContent = Math.round(state.zoom * 100) + '%';
  }
  function fitLightbox() {
    const stage = $('lbStage');
    if (!stage || !state.imgW || !state.imgH) return;
    state.fitZoom = Math.max(0.001, Math.min(Math.max(1, stage.clientWidth - 28) / state.imgW, Math.max(1, stage.clientHeight - 28) / state.imgH));
    state.zoom = state.fitZoom;
    state.panX = 0;
    state.panY = 0;
    applyTransform();
  }
  function zoomBy(factor, cx, cy) {
    const stage = $('lbStage');
    if (!stage || !state.imgW) return;
    const prev = state.zoom;
    state.zoom = Math.max(state.fitZoom * 0.25, Math.min(Math.max(8, state.fitZoom), state.zoom * factor));
    const x = (cx ?? stage.clientWidth / 2) - stage.clientWidth / 2;
    const y = (cy ?? stage.clientHeight / 2) - stage.clientHeight / 2;
    state.panX = x - (x - state.panX) * state.zoom / prev;
    state.panY = y - (y - state.panY) * state.zoom / prev;
    applyTransform();
  }

  function openLightbox(id) {
    const list = getFilteredPreviews();
    const idx = list.findIndex(s => s.id === id);
    if (idx < 0) return;
    state.lbIndex = idx;
    $('lightbox').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderLightbox();
  }

  function closeLightbox() {
    $('lightbox').classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function renderLightbox() {
    const list = getFilteredPreviews();
    const item = list[state.lbIndex];
    if (!item) return;

    $('lbName').textContent = item.name;
    $('lbCounter').textContent = `${state.lbIndex + 1} / ${list.length}`;
    $('lbPrev').disabled = state.lbIndex <= 0;
    $('lbNext').disabled = state.lbIndex >= list.length - 1;
    $('lbDl').href = item.downloadUrl;
    $('lbDl').download = item.name;

    state.imgW = 0;
    state.imgH = 0;
    $('lbStatus').textContent = '正在加载原图…';
    $('lbStatus').classList.remove('hidden');

    const img = $('lbImg');
    img.onload = () => {
      state.imgW = img.naturalWidth;
      state.imgH = img.naturalHeight;
      $('lbStatus').classList.add('hidden');
      fitLightbox();
    };
    img.onerror = () => {
      $('lbStatus').textContent = '图片加载失败，请刷新或直接下载查看。';
      $('lbStatus').classList.remove('hidden');
    };
    img.src = item.url;
    if (img.complete && img.naturalWidth) {
      state.imgW = img.naturalWidth;
      state.imgH = img.naturalHeight;
      $('lbStatus').classList.add('hidden');
      fitLightbox();
    }

    const canParams = Boolean(state.portal?.permissions?.viewParams);
    $('lightbox').classList.toggle('no-info', !state.lbInfo);
    const renderInfoPanel = (metaText) => {
      $('lbInfo').innerHTML = `
        <h3>样图信息</h3>
        <div class="lb-field"><label>分组</label><p>${esc(item.group)}</p></div>
        <div class="lb-field"><label>轮次标识</label><p class="mono">${esc(item.epoch)}</p></div>
        <div class="lb-field"><label>文件体积</label><p class="mono">${formatBytes(item.size)}</p></div>
        <div class="lb-field"><label>文件名</label><p class="mono">${esc(item.name)}</p></div>
        <div class="lb-field">
          <label>生成参数</label>
          ${!canParams
            ? `<div class="lb-locked-note">当前处于预览阶段，训练与生成参数处于保密隐藏状态。开通「可见训练参数」权限后将自动展示。</div>`
            : metaText
              ? `<pre class="lb-pre">${esc(metaText)}</pre>`
              : `<div class="lb-locked-note">此图片文件内未附带 PNG 生成参数。</div>`}
        </div>
      `;
    };

    if (!canParams) {
      renderInfoPanel('');
      return;
    }

    if (state.lbMetaCache.has(item.id)) {
      renderInfoPanel(state.lbMetaCache.get(item.id));
      return;
    }

    renderInfoPanel('正在读取图片元数据…');
    try {
      const meta = await apiJson(`/api/portal/${encodeURIComponent(state.token)}/previews/${encodeURIComponent(item.id)}/metadata`);
      const text = meta?.parameters || (Object.keys(meta || {}).length ? JSON.stringify(meta, null, 2) : '');
      state.lbMetaCache.set(item.id, text);
      if (list[state.lbIndex]?.id === item.id) renderInfoPanel(text);
    } catch {
      if (list[state.lbIndex]?.id === item.id) renderInfoPanel('');
    }
  }

  /* 交互事件 */
  $('gateForm').addEventListener('submit', e => {
    e.preventDefault();
    const token = extractTokenFromUrlOrInput($('gateInput').value);
    if (!token) return;
    window.history.pushState(null, '', `/p/${encodeURIComponent(token)}`);
    void loadPortal(token);
  });

  function closeMobileRail() {
    $('rail').classList.remove('open');
    $('railBackdrop').classList.add('hidden');
  }

  $('menuBtn').addEventListener('click', () => {
    const open = !$('rail').classList.contains('open');
    $('rail').classList.toggle('open', open);
    $('railBackdrop').classList.toggle('hidden', !open);
  });
  $('railBackdrop').addEventListener('click', closeMobileRail);

  $('groupNav').addEventListener('click', e => {
    const btn = e.target.closest('[data-group]');
    if (!btn) return;
    state.view = 'gallery';
    state.group = btn.dataset.group;
    closeMobileRail();
    renderAll();
  });

  $('deliverNav').addEventListener('click', e => {
    const btn = e.target.closest('[data-view]');
    if (!btn || btn.disabled) return;
    state.view = btn.dataset.view;
    closeMobileRail();
    renderAll();
  });

  $('searchInput').addEventListener('input', e => {
    state.query = e.target.value;
    void renderContent();
  });
  $('sortSelect').addEventListener('change', e => {
    state.sort = e.target.value;
    void renderContent();
  });
  $('densityRange').addEventListener('input', e => {
    document.documentElement.style.setProperty('--thumb-size', `${e.target.value}px`);
  });
  $('selectToggleBtn').addEventListener('click', () => {
    state.selecting = !state.selecting;
    renderTopbar();
    void renderContent();
  });
  $('selectAllBtn').addEventListener('click', () => {
    getFilteredPreviews().forEach(s => state.selected.add(s.id));
    renderTopbar();
    void renderContent();
  });
  $('clearSelBtn').addEventListener('click', () => {
    state.selected.clear();
    renderTopbar();
    void renderContent();
  });
  $('refreshBtn').addEventListener('click', () => {
    if (state.token) void loadPortal(state.token).then(() => showToast('已刷新最新授权与预览列表'));
  });

  $('batchDlBtn').addEventListener('click', async () => {
    const ids = [...state.selected];
    if (!ids.length) return;
    const btn = $('batchDlBtn');
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '正在打包 ZIP…';
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(state.token)}/previews/batch-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '批量打包失败');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'previews_pack.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(`已打包下载 ${ids.length} 张预览图`);
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  $('mainContent').addEventListener('click', async e => {
    const chk = e.target.closest('[data-check]');
    if (chk) {
      e.stopPropagation();
      const id = chk.dataset.check;
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      state.anchorId = id;
      renderTopbar();
      void renderContent();
      return;
    }
    const card = e.target.closest('.shot-card');
    if (card) {
      const id = card.dataset.id;
      const list = getFilteredPreviews();
      if (e.shiftKey && state.anchorId) {
        const a = list.findIndex(i => i.id === state.anchorId);
        const b = list.findIndex(i => i.id === id);
        if (a >= 0 && b >= 0) {
          const [start, end] = a < b ? [a, b] : [b, a];
          state.selected = new Set(list.slice(start, end + 1).map(i => i.id));
          renderTopbar();
          void renderContent();
          return;
        }
      }
      if (state.selecting || e.ctrlKey || e.metaKey) {
        state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
        state.anchorId = id;
        renderTopbar();
        void renderContent();
      } else {
        state.anchorId = id;
        openLightbox(id);
      }
      return;
    }
    const metaBtn = e.target.closest('[data-model-meta]');
    if (metaBtn) {
      const idx = metaBtn.dataset.modelMeta;
      try {
        const res = await apiJson(`/api/portal/${encodeURIComponent(state.token)}/models/${encodeURIComponent(idx)}/preview`);
        $('metaModalTitle').textContent = res.name || 'Safetensors 元数据';
        $('metaModalBody').textContent = JSON.stringify({
          note: res.note,
          tensorCount: res.tensorCount,
          metadata: res.metadata,
          tensorsPreview: res.tensors
        }, null, 2);
        $('metaModal').classList.remove('hidden');
      } catch (err) {
        showToast(err.message);
      }
      return;
    }
    if (e.target.id === 'copyParamsBtn' && state.paramsData?.toml) {
      try {
        await navigator.clipboard.writeText(state.paramsData.toml);
        showToast('已复制脱敏训练参数 TOML');
      } catch {
        showToast('剪贴板不可用，请手动复制下方原文');
      }
      return;
    }
    if (e.target.id === 'exportTomlBtn' && state.paramsData?.toml) {
      const blob = new Blob([state.paramsData.toml], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'training_params_sanitized.toml';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  });

  /* 灯箱交互 */
  $('lbClose').addEventListener('click', closeLightbox);
  $('lbPrev').addEventListener('click', () => { if (state.lbIndex > 0) { state.lbIndex--; void renderLightbox(); } });
  $('lbNext').addEventListener('click', () => { if (state.lbIndex < getFilteredPreviews().length - 1) { state.lbIndex++; void renderLightbox(); } });
  $('lbInfoToggle').addEventListener('click', () => {
    state.lbInfo = !state.lbInfo;
    $('lightbox').classList.toggle('no-info', !state.lbInfo);
    setTimeout(fitLightbox, 20);
  });
  $('zoomIn').addEventListener('click', () => zoomBy(1.25));
  $('zoomOut').addEventListener('click', () => zoomBy(0.8));
  $('zoomFit').addEventListener('click', fitLightbox);
  $('zoomActual').addEventListener('click', () => { state.zoom = 1; state.panX = 0; state.panY = 0; applyTransform(); });

  const stage = $('lbStage');
  let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomBy(Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.002), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = state.panX;
    origY = state.panY;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', e => {
    if (!dragging) return;
    state.panX = origX + (e.clientX - startX);
    state.panY = origY + (e.clientY - startY);
    applyTransform();
  });
  stage.addEventListener('pointerup', () => { dragging = false; stage.classList.remove('dragging'); });
  stage.addEventListener('pointercancel', () => { dragging = false; stage.classList.remove('dragging'); });
  stage.addEventListener('dblclick', fitLightbox);
  window.addEventListener('resize', () => {
    if (!$('lightbox').classList.contains('hidden')) fitLightbox();
  });

  document.addEventListener('keydown', e => {
    if (!$('metaModal').classList.contains('hidden') && e.key === 'Escape') {
      $('metaModal').classList.add('hidden');
      return;
    }
    if ($('lightbox').classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft' && state.lbIndex > 0) { state.lbIndex--; void renderLightbox(); }
    if (e.key === 'ArrowRight' && state.lbIndex < getFilteredPreviews().length - 1) { state.lbIndex++; void renderLightbox(); }
    if (e.key === '+' || e.key === '=') zoomBy(1.25);
    if (e.key === '-') zoomBy(0.8);
    if (e.key === '0') fitLightbox();
  });

  $('metaModalClose').addEventListener('click', () => $('metaModal').classList.add('hidden'));
  $('metaModal').addEventListener('click', e => { if (e.target === $('metaModal')) $('metaModal').classList.add('hidden'); });

  window.addEventListener('popstate', () => {
    const tok = currentTokenFromLocation();
    if (tok) void loadPortal(tok);
    else showGate();
  });

  const initialToken = currentTokenFromLocation();
  if (initialToken) {
    void loadPortal(initialToken);
  } else {
    showGate();
  }
})();
