/* ============================================================
   music.js — 黑胶唱片播放器交互逻辑
   路径: themes/maupassant/source/js/music.js
   ============================================================ */

(function () {
  'use strict';

  /* ── DOM refs ── */
  const audio        = document.getElementById('audioEl');
  const vinyl        = document.getElementById('vinyl');
  const tonearm      = document.getElementById('tonearm');
  const glow         = document.getElementById('discGlow');
  const playIcon     = document.getElementById('playIcon');
  const progressFill = document.getElementById('progressFill');
  const progressThumb= document.getElementById('progressThumb');
  const progressTrack= document.getElementById('progressTrack');
  const timeCurrent  = document.getElementById('timeCurrent');
  const timeDuration = document.getElementById('timeDuration');
  const volTrack     = document.getElementById('volTrack');
  const volFill      = document.getElementById('volFill');
  const labelTitle   = document.getElementById('labelTitle');
  const labelCover   = document.getElementById('labelCover');
  const vinylLabel   = document.getElementById('vinylLabel');
  const trackTitle   = document.getElementById('trackTitle');
  const trackArtist  = document.getElementById('trackArtist');
  const trackAlbum   = document.getElementById('trackAlbum');
  const shuffleBtn   = document.getElementById('shuffleBtn');
  const loopBtn      = document.getElementById('loopBtn');
  const lyricsStage  = document.getElementById('lyricsStage');
  const lyricsPanel  = document.getElementById('lyricsPanel');
  const playlistPanel= document.getElementById('playlistPanel');
  const tabPlaylist  = document.getElementById('tabPlaylist');
  const tabLyrics    = document.getElementById('tabLyrics');

  /* ── State ── */
  let currentIdx   = -1;
  let isPlaying    = false;
  let isShuffle    = false;
  let isLoop       = false;
  let volume       = 0.8;
  let currentLyrics = [];   // [{time: 12.34, text: '...'}, ...]
  let activeLyricIdx = -1;

  /* ── Build playlist from DOM (data comes from source/_data/music.yml) ── */
  const rawItems  = Array.from(document.querySelectorAll('.playlist-item'));
  const playlist  = rawItems.map((el, i) => ({
    el,
    src:    el.dataset.src    || '',
    title:  el.dataset.title  || '未知曲目',
    artist: el.dataset.artist || '未知艺术家',
    album:  el.dataset.album  || '',
    lrc:    el.dataset.lrc    || '',
    cover:  el.dataset.cover  || '',
    dur:    null,   // 在线链接时长未知，加载后由 loadedmetadata 实时填充
  }));

  /* Render playlist items */
  playlist.forEach((track, i) => {
    track.el.innerHTML = `
      <span class="pl-num">${i + 1}</span>
      <div class="pl-info">
        <div class="pl-name">${track.title}</div>
        <div class="pl-sub">${track.artist}</div>
      </div>
      <span class="pl-dur">--:--</span>
    `;
    track.el.addEventListener('click', () => loadTrack(i, true));
  });

  /* ── Helpers ── */
  function fmt(sec) {
    if (isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function setPlayingState(playing) {
    isPlaying = playing;
    vinyl.classList.toggle('playing', playing);
    tonearm.classList.toggle('playing', playing);
    glow.classList.toggle('playing', playing);
    playIcon.innerHTML = playing
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
      : '<polygon points="5 3 19 12 5 21"/>';
	const caption = document.getElementById('discCaption');
      if (caption) {
        caption.classList.toggle('playing', playing);
      }
  }

  /* ── 封面图加载 ── */
  function loadCover(coverUrl, fallbackTitle) {
    // 清除之前的错误状态
    labelCover.classList.remove('error');
    
    if (!coverUrl) {
      // 没有封面图：显示文字
      labelCover.style.backgroundImage = 'none';
      vinylLabel.classList.remove('has-cover');
      labelTitle.textContent = fallbackTitle || '请选择歌曲';
      return;
    }

    // 先用淡出效果隐藏封面
    labelCover.style.opacity = '0';
    
    // 使用 Image 对象预加载，检测图片是否有效
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = function() {
      // 图片加载成功：设置背景图并显示
      labelCover.style.backgroundImage = `url("${coverUrl}")`;
      vinylLabel.classList.add('has-cover');
      // 淡入效果
      setTimeout(() => {
        labelCover.style.opacity = '1';
      }, 50);
    };
    
    img.onerror = function() {
      // 图片加载失败：回退到文字显示
      console.warn('封面图加载失败:', coverUrl);
      labelCover.style.backgroundImage = 'none';
      labelCover.classList.add('error');
      vinylLabel.classList.remove('has-cover');
      labelTitle.textContent = fallbackTitle || '封面加载失败';
    };
    
    // 开始加载图片
    img.src = coverUrl;
  }

  /* ── LRC 歌词解析 ──
     支持格式: [mm:ss.xx]歌词文本，单行可能有多个时间标签
     例: [00:12.34][00:45.67]副歌歌词 */
  function parseLRC(raw) {
    const lines = raw.split(/\r?\n/);
    const timeTag = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const result = [];

    lines.forEach(line => {
      const tags = [...line.matchAll(timeTag)];
      if (!tags.length) return;
      const text = line.replace(timeTag, '').trim();
      if (!text) return; // 跳过纯时间戳无文字的行（如作词信息）

      tags.forEach(tag => {
        const min = parseInt(tag[1], 10);
        const sec = parseInt(tag[2], 10);
        const msRaw = tag[3] || '0';
        const ms = parseInt(msRaw.padEnd(3, '0'), 10);
        const time = min * 60 + sec + ms / 1000;
        result.push({ time, text });
      });
    });

    result.sort((a, b) => a.time - b.time);
    return result;
  }

  function renderLyricsPlaceholder(msg) {
    lyricsStage.innerHTML = `<p class="lyrics-placeholder">${msg}</p >`;
    currentLyrics = [];
    activeLyricIdx = -1;
  }

  function renderLyrics(lines) {
    currentLyrics = lines;
    activeLyricIdx = -1;
    /* 一次性渲染全部行，syncLyrics 通过切换 class 控制显示哪几行 */
    lyricsStage.innerHTML = lines.map((l, i) =>
      `<p class="lyrics-line" data-idx="${i}" data-time="${l.time}" style="display:none">${escapeHtml(l.text)}</p >`
    ).join('');

    lyricsStage.querySelectorAll('.lyrics-line').forEach(el => {
      el.addEventListener('click', () => {
        const t = parseFloat(el.dataset.time);
        if (!isNaN(t)) audio.currentTime = t;
      });
    });

    /* 默认先显示第一行作为待播提示 */
    if (lines.length) {
      const first = lyricsStage.querySelector('.lyrics-line[data-idx="0"]');
      if (first) { first.style.display = ''; first.classList.add('current'); }
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /* 加载并解析指定曲目的 LRC 文件；没有 lrc 字段则显示占位提示 */
  function loadLyrics(lrcUrl) {
    if (!lrcUrl) {
      renderLyricsPlaceholder('这首歌暂无歌词');
      return;
    }
    renderLyricsPlaceholder('歌词加载中…');
    fetch(lrcUrl)
      .then(res => {
        if (!res.ok) throw new Error('lrc fetch failed');
        return res.text();
      })
      .then(text => {
        const parsed = parseLRC(text);
        if (!parsed.length) {
          renderLyricsPlaceholder('歌词解析失败');
        } else {
          renderLyrics(parsed);
        }
      })
      .catch(() => renderLyricsPlaceholder('歌词加载失败'));
  }

  /* 逐行显示：只显示当前行 + 前一行 + 后一行（用于过渡视觉层次），其余隐藏 */
  function syncLyrics(currentTime) {
    if (!currentLyrics.length) return;

    let idx = -1;
    for (let i = 0; i < currentLyrics.length; i++) {
      if (currentLyrics[i].time <= currentTime) idx = i;
      else break;
    }

    if (idx === activeLyricIdx) return;
    activeLyricIdx = idx;

    const allLines = lyricsStage.querySelectorAll('.lyrics-line');
    allLines.forEach(el => {
      el.style.display = 'none';
      el.classList.remove('current', 'prev', 'next');
    });

    if (idx < 0) {
      // 还没到第一句歌词，显示第一行作为待播提示
      const first = lyricsStage.querySelector('.lyrics-line[data-idx="0"]');
      if (first) { first.style.display = ''; first.classList.add('current'); }
      return;
    }

    const prevEl = lyricsStage.querySelector(`.lyrics-line[data-idx="${idx - 1}"]`);
    const curEl  = lyricsStage.querySelector(`.lyrics-line[data-idx="${idx}"]`);
    const nextEl = lyricsStage.querySelector(`.lyrics-line[data-idx="${idx + 1}"]`);

    if (prevEl) { prevEl.style.display = ''; prevEl.classList.add('prev'); }
    if (curEl)  { curEl.style.display  = ''; curEl.classList.add('current'); }
    if (nextEl) { nextEl.style.display = ''; nextEl.classList.add('next'); }

    // 自动滚动到当前行
    if (curEl) {
      curEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /* ── 列表 / 歌词 Tab 切换 ── */
  window.switchPanel = function (panel) {
    const showLyrics = panel === 'lyrics';
    playlistPanel.classList.toggle('is-hidden', showLyrics);
    lyricsPanel.classList.toggle('is-hidden', !showLyrics);
    tabPlaylist.classList.toggle('active', !showLyrics);
    tabLyrics.classList.toggle('active', showLyrics);
  };

  function loadTrack(idx, autoPlay) {
    if (idx < 0 || idx >= playlist.length) return;

    /* Deactivate old */
    if (currentIdx >= 0) {
      playlist[currentIdx].el.classList.remove('active');
      playlist[currentIdx].el.querySelector('.pl-num').textContent = currentIdx + 1;
    }

    currentIdx = idx;
    const track = playlist[idx];

    /* Activate new */
    track.el.classList.add('active');
    track.el.querySelector('.pl-num').textContent = '♪';

    /* Update meta */
    trackTitle.textContent  = track.title;
    trackArtist.textContent = track.artist;
    trackAlbum.textContent  = track.album;
    labelTitle.textContent  = track.title;

    /* 封面图：使用优化后的加载函数 */
    loadCover(track.cover, track.title);

    /* Load lyrics for this track */
    loadLyrics(track.lrc);

    /* Load audio */
    audio.src = track.src;
    audio.volume = volume;

    if (autoPlay) {
      audio.play().then(() => setPlayingState(true)).catch(() => setPlayingState(false));
    }

    /* Reset progress */
    progressFill.style.width  = '0%';
    progressThumb.style.left  = '0%';
    timeCurrent.textContent   = '0:00';
    timeDuration.textContent  = '--:--';
  }

  /* ── Controls ── */
  window.togglePlay = function () {
    if (currentIdx < 0) { loadTrack(0, true); return; }
    if (isPlaying) {
      audio.pause();
      setPlayingState(false);
    } else {
      audio.play().then(() => setPlayingState(true));
    }
  };

  window.nextTrack = function () {
    let next;
    if (isShuffle) {
      next = Math.floor(Math.random() * playlist.length);
    } else {
      next = (currentIdx + 1) % playlist.length;
    }
    loadTrack(next, isPlaying);
  };

  window.prevTrack = function () {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    const prev = (currentIdx - 1 + playlist.length) % playlist.length;
    loadTrack(prev, isPlaying);
  };

  window.toggleShuffle = function () {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
  };

  window.toggleLoop = function () {
    isLoop = !isLoop;
    audio.loop = isLoop;
    loopBtn.classList.toggle('active', isLoop);
  };

  /* ── Audio events ── */
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    progressFill.style.width  = pct + '%';
    progressThumb.style.left  = pct + '%';
    timeCurrent.textContent   = fmt(audio.currentTime);
    timeDuration.textContent  = fmt(audio.duration);
    syncLyrics(audio.currentTime);
  });

  audio.addEventListener('ended', () => {
    if (!isLoop) window.nextTrack();
  });

  audio.addEventListener('play',  () => setPlayingState(true));
  audio.addEventListener('pause', () => setPlayingState(false));

  /* 在线音频：元数据加载完成后回填该曲目的时长显示 */
  audio.addEventListener('loadedmetadata', () => {
    if (currentIdx < 0) return;
    const durEl = playlist[currentIdx].el.querySelector('.pl-dur');
    if (durEl) durEl.textContent = fmt(audio.duration);
    timeDuration.textContent = fmt(audio.duration);
  });

  /* 在线链接失效或网络问题时的提示，而不是静默卡住 */
  audio.addEventListener('error', () => {
    setPlayingState(false);
    if (currentIdx >= 0) {
      trackTitle.textContent = playlist[currentIdx].title + '（加载失败，请检查链接）';
    }
  });

  audio.addEventListener('waiting', () => {
    trackArtist.textContent = '缓冲中…';
  });
  audio.addEventListener('canplay', () => {
    if (currentIdx >= 0) trackArtist.textContent = playlist[currentIdx].artist;
  });

  /* ── Progress seek ── */
  function seek(e) {
    const rect = progressTrack.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audio.duration) audio.currentTime = pct * audio.duration;
  }
  let seeking = false;
  progressTrack.addEventListener('mousedown', e => { seeking = true; seek(e); });
  document.addEventListener('mousemove', e => { if (seeking) seek(e); });
  document.addEventListener('mouseup',   () => { seeking = false; });

  /* Touch seek */
  progressTrack.addEventListener('touchstart', e => {
    seek(e.touches[0]); e.preventDefault();
  }, { passive: false });
  progressTrack.addEventListener('touchmove', e => {
    seek(e.touches[0]); e.preventDefault();
  }, { passive: false });

  /* ── Volume ── */
  function setVolume(e) {
    const rect = volTrack.getBoundingClientRect();
    volume = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.volume = volume;
    volFill.style.width = (volume * 100) + '%';
  }
  let volDragging = false;
  volTrack.addEventListener('mousedown', e => { volDragging = true; setVolume(e); });
  document.addEventListener('mousemove', e => { if (volDragging) setVolume(e); });
  document.addEventListener('mouseup',   () => { volDragging = false; });

  /* Touch support for volume (previously missing — caused unresponsive drag on mobile) */
  volTrack.addEventListener('touchstart', e => {
    setVolume(e.touches[0]); e.preventDefault();
  }, { passive: false });
  volTrack.addEventListener('touchmove', e => {
    setVolume(e.touches[0]); e.preventDefault();
  }, { passive: false });

  /* ── Keyboard shortcuts ── */
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space')      { e.preventDefault(); window.togglePlay(); }
    if (e.code === 'ArrowRight') { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); }
    if (e.code === 'ArrowLeft')  { audio.currentTime = Math.max(0, audio.currentTime - 5); }
    if (e.code === 'ArrowUp')    { volume = Math.min(1, volume + .1); audio.volume = volume; volFill.style.width = (volume*100)+'%'; }
    if (e.code === 'ArrowDown')  { volume = Math.max(0, volume - .1); audio.volume = volume; volFill.style.width = (volume*100)+'%'; }
  });

  /* ── Auto-load first track ── */
  if (playlist.length > 0) loadTrack(0, false);

})();