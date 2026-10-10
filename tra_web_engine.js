(() => {
  const MAX_BUFFER_SECONDS = 180;
  const TIMESLICE_MS = 1000;

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
    replayVideo: null,
    compareVideoA: null,
    compareVideoB: null,
    compareBlobUrl: '',
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
    const mediaSource = new MediaSource();
    state.mediaSource = mediaSource;
    state.sourceBuffer = null;
    state.appendQueue = [];
    state.bufferStart = 0;
    state.bufferEnd = 0;
    state.replayVideo.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
      try {
        const sourceBuffer = mediaSource.addSourceBuffer(state.mimeType);
        sourceBuffer.mode = 'sequence';
        sourceBuffer.addEventListener('updateend', drainAppendQueue);
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
    if (!sb || sb.updating || state.appendQueue.length === 0) return;
    const blob = state.appendQueue.shift();
    try {
      sb.appendBuffer(await blobBytes(blob));
    } catch (error) {
      console.warn('[TRA] appendBuffer failed', error);
      setTimeout(drainAppendQueue, 100);
    }
  }

  function trimChunkMemory() {
    const cutoff = Math.max(0, state.bufferEnd - MAX_BUFFER_SECONDS);
    while (state.chunks.length > 1 && state.chunks[0].end < cutoff) {
      state.chunks.shift();
    }
    state.bufferStart = state.chunks.length ? state.chunks[0].start : 0;

    const sb = state.sourceBuffer;
    if (sb && !sb.updating && sb.buffered.length > 0) {
      const bufferedStart = sb.buffered.start(0);
      const removeUntil = Math.min(cutoff, state.replayVideo.currentTime - 2);
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
      const cameras = devices
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
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
    video.currentTime = Math.max(start, end - 10);
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
    if (video?.buffered?.length) return video.buffered.start(0);
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

  window.traWebEnginePrepareCompare = async function(beforeSeconds, afterSeconds) {
    try {
      ensureElements();
      const available = state.chunks.map((item) => item.blob);
      if (!available.length) return false;
      if (state.initChunk && available[0] !== state.initChunk) available.unshift(state.initChunk);
      revokeCompareBlob();
      state.compareBlobUrl = URL.createObjectURL(new Blob(available, { type: state.mimeType }));
      state.compareVideoA.src = state.compareBlobUrl;
      state.compareVideoB.src = state.compareBlobUrl;
      state.compareVideoA.load();
      state.compareVideoB.load();
      await Promise.all([waitForMetadata(state.compareVideoA), waitForMetadata(state.compareVideoB)]);
      const start = state.bufferStart;
      const a = Math.max(start, Math.min(state.bufferEnd, Number(beforeSeconds) || start));
      const b = Math.max(start, Math.min(state.bufferEnd, Number(afterSeconds) || start));
      state.compareVideoA.currentTime = Math.max(0, a - start);
      state.compareVideoB.currentTime = Math.max(0, b - start);
      state.compareVideoA.playbackRate = state.replayVideo?.playbackRate || 1;
      state.compareVideoB.playbackRate = state.replayVideo?.playbackRate || 1;
      state.compareVideoA.pause();
      state.compareVideoB.pause();
      return true;
    } catch (error) {
      state.lastError = String(error?.message || error);
      console.error('[TRA] Compare prepare failed', error);
      return false;
    }
  };

  window.traWebEngineComparePlay = async function() {
    try {
      await Promise.all([state.compareVideoA.play(), state.compareVideoB.play()]);
      return true;
    } catch (_) { return false; }
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
    const start = state.bufferStart;
    if (state.compareVideoA) state.compareVideoA.currentTime = Math.max(0, Number(beforeSeconds) - start);
    if (state.compareVideoB) state.compareVideoB.currentTime = Math.max(0, Number(afterSeconds) - start);
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
      const targetPortrait = state.portrait !== (state.rotationQuarterTurns % 2 === 1);

      const ok = await window.sportReplayExportMp4Blobs(
        [combined],
        requestedSeconds,
        rangeStart,
        rangeEnd,
        targetPortrait,
        state.rotationQuarterTurns,
        state.mirror,
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
