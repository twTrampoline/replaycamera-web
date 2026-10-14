(() => {
  const MAX_BUFFER_SECONDS = 180;
  const TIMESLICE_MS = 1000;
  const MAX_BUFFER_BYTES = 48 * 1024 * 1024;

  const state = {
    sourceStream: null,
    sourceVideo: null,
    canvas: null,
    ctx: null,
    outputStream: null,
    recorder: null,
    chunks: [],
    initChunk: null,
    mimeType: '',
    startedAt: 0,
    portrait: true,
    mirror: false,
    rotationQuarterTurns: 0,
    facingMode: 'environment',
    selectedDeviceId: null,
    animationId: 0,
    mediaSource: null,
    sourceBuffer: null,
    appendQueue: [],
    appendBusy: false,
    replayGeneration: 0,
    replayVideo: null,
    compareVideoA: null,
    compareVideoB: null,
    compareBlobUrl: '',
    retentionStart: 0,
    bufferStart: 0,
    bufferEnd: 0,
    lastError: '',
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function chooseMimeType() {
    const choices = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    return choices.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function ensureElements() {
    if (!state.sourceVideo) {
      const video = document.createElement('video');
      video.id = 'tra-source-video';
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.style.display = 'none';
      document.body.appendChild(video);
      state.sourceVideo = video;
    }

    if (!state.canvas) {
      const canvas = document.createElement('canvas');
      canvas.id = 'tra-live-canvas';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.objectFit = 'contain';
      canvas.style.background = '#000';
      state.canvas = canvas;
      state.ctx = canvas.getContext('2d', { alpha: false });
    }

    if (!state.replayVideo) {
      const video = document.createElement('video');
      video.id = 'tra-replay-video';
      video.playsInline = true;
      video.controls = false;
      video.preload = 'auto';
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';
      video.style.background = '#000';
      state.replayVideo = video;
    }

    if (!state.compareVideoA) {
      const video = document.createElement('video');
      video.id = 'tra-compare-video-a';
      video.playsInline = true;
      video.controls = false;
      video.preload = 'auto';
      video.muted = true;
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';
      video.style.background = '#000';
      state.compareVideoA = video;
    }

    if (!state.compareVideoB) {
      const video = document.createElement('video');
      video.id = 'tra-compare-video-b';
      video.playsInline = true;
      video.controls = false;
      video.preload = 'auto';
      video.muted = true;
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'contain';
      video.style.background = '#000';
      state.compareVideoB = video;
    }

  }

  function targetSize() {
    const outputPortrait = state.portrait !== (state.rotationQuarterTurns % 2 === 1);
    return outputPortrait
      ? { width: 720, height: 1280 }
      : { width: 1280, height: 720 };
  }

  function resizeCanvas() {
    const size = targetSize();
    state.canvas.width = size.width;
    state.canvas.height = size.height;
  }

  function drawCover(ctx, video, cw, ch) {
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const sourcePortrait = vh >= vw;
    const layoutQuarterTurn = state.portrait !== sourcePortrait ? 1 : 0;
    const quarterTurns = (layoutQuarterTurn + state.rotationQuarterTurns) % 4;
    const rotated = quarterTurns % 2 === 1;
    const logicalW = rotated ? vh : vw;
    const logicalH = rotated ? vw : vh;
    const scale = Math.max(cw / logicalW, ch / logicalH);

    ctx.save();
    ctx.clearRect(0, 0, cw, ch);
    ctx.translate(cw / 2, ch / 2);
    if (state.mirror) ctx.scale(-1, 1);
    ctx.rotate(quarterTurns * Math.PI / 2);
    ctx.drawImage(
      video,
      -(vw * scale) / 2,
      -(vh * scale) / 2,
      vw * scale,
      vh * scale,
    );
    ctx.restore();
  }

  function renderLoop() {
    if (!state.sourceVideo || !state.ctx || !state.canvas) return;
    drawCover(
      state.ctx,
      state.sourceVideo,
      state.canvas.width,
      state.canvas.height,
    );
    state.animationId = requestAnimationFrame(renderLoop);
  }

  function resetMediaSource() {
    if (state.replayVideo?.src) {
      try { URL.revokeObjectURL(state.replayVideo.src); } catch (_) {}
    }
    const generation = ++state.replayGeneration;
    state.appendBusy = false;
    const mediaSource = new MediaSource();
    state.mediaSource = mediaSource;
    state.sourceBuffer = null;
    state.appendQueue = [];
    state.retentionStart = 0;
    state.bufferStart = 0;
    state.bufferEnd = 0;
    state.replayVideo.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
      if (generation !== state.replayGeneration) return;
      try {
        const sourceBuffer = mediaSource.addSourceBuffer(state.mimeType);
        sourceBuffer.mode = 'segments';
        sourceBuffer.addEventListener('updateend', () => {
          if (generation !== state.replayGeneration) return;
          trimChunkMemory();
          drainAppendQueue();
        });
        sourceBuffer.addEventListener('error', (event) => {
          console.error('[TRA] SourceBuffer error', event);
        });
        state.sourceBuffer = sourceBuffer;
        drainAppendQueue();
      } catch (error) {
        state.lastError = `MediaSource 初始化失敗：${error}`;
        console.error('[TRA]', state.lastError);
      }
    }, { once: true });
  }

  async function blobBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  function queueForReplay(blob) {
    state.appendQueue.push(blob);
    drainAppendQueue();
  }

  async function drainAppendQueue() {
    const sb = state.sourceBuffer;
    if (!sb || sb.updating || state.appendBusy || state.appendQueue.length === 0) return;
    const generation = state.replayGeneration;
    const blob = state.appendQueue[0];
    state.appendBusy = true;
    let retry = false;
    try {
      const bytes = await blobBytes(blob);
      if (generation !== state.replayGeneration || sb !== state.sourceBuffer) return;
      // Keep the head until appendBuffer accepts it. Blob conversion is async,
      // so a second recorder event must not overtake the first segment.
      if (sb.updating) { retry = true; return; }
      sb.appendBuffer(bytes);
      state.appendQueue.shift();
    } catch (error) {
      if (generation !== state.replayGeneration) return;
      console.warn('[TRA] appendBuffer failed', error);
      if (error.name === 'QuotaExceededError') {
        state.appendBusy = false;
        // Browser MSE quotas can be smaller than our time-based window.
        // Free a small oldest portion and retry the SAME chunk, without
        // restarting the camera or discarding the remaining recording.
        if (sb.buffered.length) {
          const oldest = sb.buffered.start(0);
          const newest = sb.buffered.end(sb.buffered.length - 1);
          state.retentionStart = Math.max(state.retentionStart,
            Math.min(oldest + 10, newest - 10));
        }
        trimChunkMemory();
        retry = sb.updating;
      } else if (error.name === 'InvalidStateError' && state.mediaSource?.readyState === 'open') {
        retry = true;
      }
      if (!retry) state.lastError = '回放緩衝無法更新，請重新啟動相機。';
    } finally {
      if (generation === state.replayGeneration) {
        state.appendBusy = false;
        if (retry) setTimeout(drainAppendQueue, 100);
      }
    }
  }

  function trimChunkMemory() {
    let retainedBytes = state.chunks.reduce((sum, item) => sum + (item.blob?.size || 0), 0);
    let cutoff = Math.max(state.retentionStart, 0, state.bufferEnd - MAX_BUFFER_SECONDS);
    // Limit encoded bytes too: a busy 60fps scene can exceed the browser's
    // memory quota well before the three-minute time limit.
    while (state.chunks.length > 1 &&
        (state.chunks[0].end < cutoff || retainedBytes > MAX_BUFFER_BYTES)) {
      const removed = state.chunks.shift();
      retainedBytes -= removed.blob?.size || 0;
      cutoff = Math.max(cutoff, removed.end);
    }
    state.retentionStart = cutoff;
    while (state.chunks.length > 1 && state.chunks[0].end < cutoff) {
      state.chunks.shift();
    }
    state.bufferStart = state.chunks.length ? state.chunks[0].start : 0;

    const sb = state.sourceBuffer;
    if (sb && !sb.updating && !state.appendBusy && sb.buffered.length > 0) {
      const bufferedStart = sb.buffered.start(0);
      const removeUntil = cutoff;
      if (state.replayVideo.currentTime < cutoff) state.replayVideo.currentTime = cutoff;
      if (removeUntil > bufferedStart + 1) {
        try { sb.remove(bufferedStart, removeUntil); } catch (_) {}
      }
    }
  }

  function startRecorder() {
    state.mimeType = chooseMimeType();
    if (!state.mimeType) throw new Error('瀏覽器不支援 WebM MediaRecorder');

    state.outputStream = state.canvas.captureStream(60);
    state.recorder = new MediaRecorder(state.outputStream, {
      mimeType: state.mimeType,
      videoBitsPerSecond: 8_000_000,
    });
    state.startedAt = performance.now();
    state.chunks = [];
    state.initChunk = null;
    resetMediaSource();

    state.recorder.addEventListener('dataavailable', (event) => {
      if (!event.data || event.data.size === 0) return;
      const end = (performance.now() - state.startedAt) / 1000;
      const previous = state.chunks[state.chunks.length - 1];
      const start = previous ? previous.end : 0;
      const item = { blob: event.data, start, end };
      if (!state.initChunk) state.initChunk = event.data;
      state.chunks.push(item);
      state.bufferEnd = end;
      state.bufferStart = Math.max(0, end - MAX_BUFFER_SECONDS);
      queueForReplay(event.data);
      trimChunkMemory();
    });

    state.recorder.addEventListener('error', (event) => {
      state.lastError = `錄影器錯誤：${event.error || event}`;
      console.error('[TRA]', state.lastError);
    });

    state.recorder.start(TIMESLICE_MS);
  }

  async function stopRecorder() {
    if (state.recorder && state.recorder.state !== 'inactive') {
      await new Promise((resolve) => {
        state.recorder.addEventListener('stop', resolve, { once: true });
        state.recorder.stop();
      });
    }
    state.recorder = null;
    state.outputStream?.getTracks().forEach((track) => track.stop());
    state.outputStream = null;
  }

  async function stopCamera() {
    await stopRecorder();
    if (state.animationId) cancelAnimationFrame(state.animationId);
    state.animationId = 0;
    state.sourceStream?.getTracks().forEach((track) => track.stop());
    state.sourceStream = null;
    if (state.sourceVideo) state.sourceVideo.srcObject = null;
  }

  async function startCamera() {
    ensureElements();
    resizeCanvas();
    state.lastError = '';

    const videoConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60, max: 60 },
    };
    if (state.selectedDeviceId) {
      videoConstraints.deviceId = { exact: state.selectedDeviceId };
    } else {
      videoConstraints.facingMode = { ideal: state.facingMode };
    }

    state.sourceStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints,
    });
    const videoTrack = state.sourceStream.getVideoTracks()[0];
    if (videoTrack) {
      try {
        await videoTrack.applyConstraints({ frameRate: { ideal: 60, max: 60 } });
      } catch (_) {}
    }
    state.sourceVideo.srcObject = state.sourceStream;
    await state.sourceVideo.play();
    await new Promise((resolve) => {
      if (state.sourceVideo.videoWidth) resolve();
      else state.sourceVideo.addEventListener('loadedmetadata', resolve, { once: true });
    });

    renderLoop();
    startRecorder();
  }

  window.traWebEngineInit = async function(portrait, mirror) {
    try {
      await stopCamera();
      state.portrait = Boolean(portrait);
      state.mirror = Boolean(mirror);
      await startCamera();
      return true;
    } catch (error) {
      state.lastError = String(error?.message || error);
      console.error('[TRA] Web engine init failed', error);
      return false;
    }
  };

  window.traWebEngineSetLayout = async function(portrait) {
    state.portrait = Boolean(portrait);
    try {
      await stopRecorder();
      resizeCanvas();
      startRecorder();
      return true;
    } catch (error) {
      state.lastError = String(error?.message || error);
      return false;
    }
  };

  window.traWebEngineSetRotation = function(quarterTurns) {
    state.rotationQuarterTurns = ((Number(quarterTurns) || 0) % 4 + 4) % 4;
    resizeCanvas();
    return true;
  };

  window.traWebEngineSetMirror = function(mirror) {
    state.mirror = Boolean(mirror);
    return true;
  };

  window.traWebEngineSwitchCamera = async function() {
    state.selectedDeviceId = null;
    state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
    return window.traWebEngineInit(state.portrait, state.mirror);
  };

  window.traWebEngineCameraDevicesJson = async function() {
    try {
      // Device labels are normally available after camera permission is granted.
      const devices = await navigator.mediaDevices.enumerateDevices();
      const activeId = state.sourceStream?.getVideoTracks()[0]?.getSettings().deviceId;
      const cameras = devices
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          active: device.deviceId === activeId,
          label: device.label || `相機 ${index + 1}`,
        }));
      return JSON.stringify(cameras);
    } catch (error) {
      state.lastError = String(error?.message || error);
      return '[]';
    }
  };

  let selectingCamera = false;
  window.traWebEngineSelectCamera = async function(deviceId) {
    if (selectingCamera) return false;
    selectingCamera = true;
    const previousDeviceId = state.selectedDeviceId;
    try {
      const selected = String(deviceId || '');
      if (!selected) throw new Error('找不到所選鏡頭，請重新選擇。');
      if (selected === state.sourceStream?.getVideoTracks()[0]?.getSettings().deviceId) return true;
      state.selectedDeviceId = selected;
      await stopCamera();
      await startCamera();
      return true;
    } catch (error) {
      const messages = {
        NotAllowedError: '未獲相機權限，請在瀏覽器設定允許使用相機。',
        NotFoundError: '找不到所選鏡頭，請確認裝置已連接。',
        NotReadableError: '鏡頭暫時無法使用，請關閉其他使用相機的程式再試。',
        OverconstrainedError: '所選鏡頭已無法使用，請重新選擇鏡頭。'
      };
      const message = messages[error?.name] || '無法切換鏡頭，請重新選擇或檢查裝置。';
      state.selectedDeviceId = previousDeviceId;
      try { await stopCamera(); await startCamera(); } catch (_) { await stopCamera(); }
      state.lastError = message;
      console.error('[TRA] Select camera failed', error);
      return false;
    } finally { selectingCamera = false; }
  };

  window.traWebEngineActualFps = function() {
    const track = state.sourceStream?.getVideoTracks?.()[0];
    const settings = track?.getSettings?.();
    const fps = Number(settings?.frameRate || 0);
    return Number.isFinite(fps) ? fps : 0;
  };

  window.traWebEngineOpenReplay = async function() {
    const video = state.replayVideo;
    if (!video) return false;
    const start = window.traWebEngineBufferStart();
    const end = window.traWebEngineBufferEnd();
    if (end <= start) {
      state.lastError = '請先等候幾秒建立回放緩衝。';
      return false;
    }
    video.currentTime = start;
    try { await video.play(); } catch (_) {}
    return true;
  };

  window.traWebEnginePlay = async function() {
    try { await state.replayVideo.play(); return true; } catch (_) { return false; }
  };
  window.traWebEnginePause = function() { state.replayVideo.pause(); return true; };
  window.traWebEngineSeek = function(seconds) {
    const start = window.traWebEngineBufferStart();
    const end = window.traWebEngineBufferEnd();
    state.replayVideo.currentTime = Math.max(start, Math.min(end, Number(seconds) || 0));
    return true;
  };
  window.traWebEngineSetSpeed = function(speed) {
    state.replayVideo.playbackRate = Number(speed) || 1;
    return true;
  };
  window.traWebEngineBufferStart = function() {
    const video = state.replayVideo;
    if (video?.buffered?.length) return Math.max(video.buffered.start(0), state.retentionStart, state.bufferEnd - MAX_BUFFER_SECONDS);
    return state.bufferStart;
  };
  window.traWebEngineBufferEnd = function() {
    const video = state.replayVideo;
    if (video?.buffered?.length) return video.buffered.end(video.buffered.length - 1);
    return state.bufferEnd;
  };
  window.traWebEnginePosition = function() { return state.replayVideo?.currentTime || 0; };
  window.traWebEngineIsPlaying = function() { return Boolean(state.replayVideo && !state.replayVideo.paused); };
  window.traWebEngineIsRecording = function() { return state.recorder?.state === 'recording'; };
  window.traWebEngineLastError = function() { return state.lastError || ''; };
  window.traWebEngineClearError = function() { state.lastError = ''; };
  window.traWebEnginePortrait = function() { return state.portrait; };


  function revokeCompareBlob() {
    if (state.compareBlobUrl) {
      try { URL.revokeObjectURL(state.compareBlobUrl); } catch (_) {}
      state.compareBlobUrl = '';
    }
  }

  async function waitForMetadata(video) {
    if (video.readyState >= 1) return;
    await new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('對比影片載入失敗')); };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', done);
        video.removeEventListener('error', fail);
      };
      video.addEventListener('loadedmetadata', done, { once: true });
      video.addEventListener('error', fail, { once: true });
    });
  }

  let compareReady = false;
  let comparePreparing = false;
  let compareUrls = [];
  async function loadCompareSnapshot(video, blobs, position) {
    const source = new MediaSource();
    const url = URL.createObjectURL(source);
    compareUrls.push(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('對比影片載入逾時，請重新選擇片段。')), 15000);
      source.addEventListener('sourceopen', async () => {
        try {
          const buffer = source.addSourceBuffer(state.mimeType);
          buffer.mode = 'segments';
          for (const blob of blobs) {
            const bytes = await blob.arrayBuffer();
            await new Promise((done, fail) => {
              const cleanup = () => { buffer.removeEventListener('updateend', finish); buffer.removeEventListener('error', error); };
              const finish = () => { cleanup(); done(); };
              const error = () => { cleanup(); fail(new Error('對比片段解碼失敗')); };
              buffer.addEventListener('updateend', finish);
              buffer.addEventListener('error', error);
              try { buffer.appendBuffer(bytes); } catch (e) { cleanup(); fail(e); }
            });
          }
          source.endOfStream();
          if (!buffer.buffered.length) throw new Error('對比緩衝尚未就緒');
          const ranges = buffer.buffered;
          let target = ranges.start(0);
          for (let i = 0; i < ranges.length; i++) {
            if (position >= ranges.start(i)) target = Math.min(position, Math.max(ranges.start(i), ranges.end(i) - 0.1));
          }
          video.currentTime = target;
          video.pause();
          clearTimeout(timer); resolve();
        } catch (e) { clearTimeout(timer); reject(e); }
      }, {once:true});
      video.src = url;
      video.load();
    });
  }

  window.traWebEnginePrepareCompare = async function(beforeSeconds, afterSeconds) {
    if (comparePreparing) return false;
    comparePreparing = true;
    compareReady = false;
    state.lastError = '';
    try {
      ensureElements();
      await flushRecorderForExport();
      const available = state.chunks.map(item => item.blob);
      if (!available.length) throw new Error('請先等候建立錄影緩衝。');
      if (state.initChunk && available[0] !== state.initChunk) available.unshift(state.initChunk);
      state.compareVideoA.pause(); state.compareVideoB.pause();
      state.compareVideoA.removeAttribute('src'); state.compareVideoB.removeAttribute('src');
      state.compareVideoA.load(); state.compareVideoB.load();
      compareUrls.forEach(url => URL.revokeObjectURL(url)); compareUrls = [];
      await Promise.all([
        loadCompareSnapshot(state.compareVideoA, available, Number(beforeSeconds) || 0),
        loadCompareSnapshot(state.compareVideoB, available, Number(afterSeconds) || 0)
      ]);
      state.compareVideoA.playbackRate = state.replayVideo?.playbackRate || 1;
      state.compareVideoB.playbackRate = state.replayVideo?.playbackRate || 1;
      compareReady = true;
      return true;
    } catch (error) {
      state.lastError = String(error?.message || error);
      return false;
    } finally { comparePreparing = false; }
  };

  window.traWebEngineComparePlay = async function() {
    if (!compareReady) { state.lastError = '請先建立前後對比，再按播放。'; return false; }
    state.lastError = '';
    try {
      await Promise.all([state.compareVideoA.play(), state.compareVideoB.play()]);
      return true;
    } catch (error) {
      state.compareVideoA.pause(); state.compareVideoB.pause();
      state.lastError = '對比播放未完成，請再按一次播放。';
      return false;
    }
  };

  window.traWebEngineComparePause = function() {
    state.compareVideoA?.pause();
    state.compareVideoB?.pause();
    return true;
  };

  window.traWebEngineCompareSetSpeed = function(speed) {
    const value = Number(speed) || 1;
    if (state.compareVideoA) state.compareVideoA.playbackRate = value;
    if (state.compareVideoB) state.compareVideoB.playbackRate = value;
    return true;
  };

  window.traWebEngineCompareSeek = function(beforeSeconds, afterSeconds) {
    if (!compareReady) return false;
    if (state.compareVideoA) state.compareVideoA.currentTime = Math.max(0, Number(beforeSeconds));
    if (state.compareVideoB) state.compareVideoB.currentTime = Math.max(0, Number(afterSeconds));
    return true;
  };

  async function flushRecorderForExport() {
    const recorder = state.recorder;
    if (!recorder || recorder.state !== 'recording') return;

    // Ask MediaRecorder to close the current cluster before exporting. This
    // makes the paused replay position available to the MP4 converter instead
    // of exporting only up to the previous one-second dataavailable event.
    await new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        recorder.removeEventListener('dataavailable', onData);
        resolve();
      };
      const onData = () => setTimeout(done, 0);
      recorder.addEventListener('dataavailable', onData, { once: true });
      try {
        recorder.requestData();
      } catch (_) {
        done();
        return;
      }
      setTimeout(done, 500);
    });
  }

  window.traWebEngineExport = async function(seconds, endAt) {
    try {
      ensureElements();
      state.lastError = '';

      // The slider position is the requested final frame. Freeze playback so
      // currentTime cannot move while the export range is being calculated.
      state.replayVideo?.pause();
      await flushRecorderForExport();

      const requestedSeconds = Math.max(1, Number(seconds) || 1);
      const bufferStart = window.traWebEngineBufferStart();
      const bufferEnd = window.traWebEngineBufferEnd();
      const requestedEnd = Number(endAt);
      const end = Math.max(
        bufferStart,
        Math.min(bufferEnd, Number.isFinite(requestedEnd) ? requestedEnd : state.replayVideo.currentTime),
      );
      const start = Math.max(bufferStart, end - requestedSeconds);

      // Include every retained chunk from the first selected cluster through
      // the cluster containing the paused final frame. Do not prepend
      // initChunk when it is already present; the old duplicate header was a
      // common cause of "MP4 conversion failed".
      const selected = state.chunks.filter(
        (item) => item.end > start && item.start < end + 0.001,
      );
      if (!selected.length) {
        throw new Error('所選時間範圍沒有可匯出的錄影片段');
      }

      const parts = [];
      const firstBlob = selected[0].blob;
      if (state.initChunk && firstBlob !== state.initChunk) {
        parts.push(state.initChunk);
      }
      for (const item of selected) {
        if (parts.length === 0 || parts[parts.length - 1] !== item.blob) {
          parts.push(item.blob);
        }
      }

      const combined = new Blob(parts, { type: state.mimeType });

      // MediaRecorder cluster timestamps remain on the original continuous
      // recorder timeline. When the rolling buffer has already discarded its
      // first chunks, we prepend initChunk only to restore the WebM header; the
      // selected clusters still keep their original timestamps (for example
      // 125-135 seconds). Therefore the trim range MUST stay absolute. The old
      // `start - selected[0].start` calculation pointed the converter into the
      // empty gap after initChunk and produced invalid/blank MP4 files.
      const rangeStart = Math.max(0, start);
      const rangeEnd = Math.max(rangeStart, end);
      const targetPortrait = state.canvas.height > state.canvas.width;

      const ok = await window.sportReplayExportMp4Blobs(
        [combined],
        requestedSeconds,
        rangeStart,
        rangeEnd,
        null, // Preserve the recorded orientation; current live layout may differ.
        0, // Rotation is already baked into the recorded canvas.
        false, // Mirroring is already baked into the recorded canvas.
      );

      if (!ok) {
        state.lastError = window.sportReplayLastExportError || 'MP4 轉換失敗';
      }
      return ok === true;
    } catch (error) {
      state.lastError = String(error?.message || error);
      console.error('[TRA] Export failed', error);
      return false;
    }
  };

  // Return the persistent DOM elements directly to Flutter's HtmlElementView.
  // These elements are intentionally not looked up with getElementById because
  // Flutter may temporarily detach them while rebuilding a platform view.
  window.traWebEngineLiveElement = function() {
    ensureElements();
    return state.canvas;
  };

  window.traWebEngineReplayElement = function() {
    ensureElements();
    return state.replayVideo;
  };

  window.traWebEngineCompareElementA = function() {
    ensureElements();
    return state.compareVideoA;
  };

  window.traWebEngineCompareElementB = function() {
    ensureElements();
    return state.compareVideoB;
  };

  window.traWebEngineActualWidth = function() {
    const track = state.sourceStream?.getVideoTracks?.()[0];
    const settings = track?.getSettings?.();
    const width = Number(settings?.width || state.sourceVideo?.videoWidth || 0);
    return Number.isFinite(width) ? width : 0;
  };

  window.traWebEngineActualHeight = function() {
    const track = state.sourceStream?.getVideoTracks?.()[0];
    const settings = track?.getSettings?.();
    const height = Number(settings?.height || state.sourceVideo?.videoHeight || 0);
    return Number.isFinite(height) ? height : 0;
  };

  window.traWebEngineDispose = async function() {
    await stopCamera();
    return true;
  };
})();
