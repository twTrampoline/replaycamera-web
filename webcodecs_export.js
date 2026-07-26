import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  CanvasSink,
  VideoSample,
  VideoSampleSource,
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.51.0/+esm';

const DEFAULT_BITRATE = 6_000_000;
const KEY_FRAME_INTERVAL_SECONDS = 2;

/**
 * Returns the primary video track and its duration.
 */
async function inspectBlob(blob) {
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });

  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    throw new Error('A selected recording segment has no video track.');
  }

  if (!(await track.canDecode())) {
    throw new Error('This browser cannot decode one of the recorded WebM segments.');
  }

  const firstTimestamp = await track.getFirstTimestamp();
  const duration = await track.computeDuration();
  const width = await track.getDisplayWidth();
  const height = await track.getDisplayHeight();

  return {
    blob,
    input,
    track,
    firstTimestamp,
    duration,
    width,
    height,
  };
}

function downloadMp4(buffer, seconds) {
  const blob = new Blob([buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `SportReplay_${seconds}s_${stamp}.mp4`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Converts cached WebM/MP4 recording segments into one genuine H.264 MP4.
 *
 * Flutter passes real Blob objects created from its in-memory segment cache,
 * so this code never fetches camera_web's protected temporary blob URLs.
 */
window.sportReplayExportMp4Blobs = async function sportReplayExportMp4Blobs(
  blobLike,
  requestedSeconds,
  requestedRangeStart,
  requestedRangeEnd,
  requestedPortrait,
  requestedRotate180,
  requestedMirror,
) {
  try {
    if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) {
      throw new Error(
        'This browser does not support WebCodecs. Please use a current Chrome or Edge.',
      );
    }

    const blobs = Array.from(blobLike ?? []);
    const seconds = Math.max(1, Number(requestedSeconds) || 1);

    if (blobs.length === 0) {
      throw new Error('No recording segments were supplied.');
    }

    console.log('[SportReplay] Inspecting segments…');
    const segments = [];
    for (const item of blobs) {
      if (!(item instanceof Blob)) {
        throw new Error('The recording cache did not supply a valid Blob.');
      }
      segments.push(await inspectBlob(item));
    }

    const totalDuration = segments.reduce(
      (sum, segment) => sum + segment.duration,
      0,
    );

    const rangeStart = Math.max(
      0,
      Math.min(totalDuration, Number(requestedRangeStart) || 0),
    );
    const rangeEnd = Math.max(
      rangeStart,
      Math.min(
        totalDuration,
        Number(requestedRangeEnd) || (rangeStart + seconds),
      ),
    );
    const exportDuration = Math.min(seconds, rangeEnd - rangeStart);

    if (exportDuration <= 0) {
      throw new Error('The selected recording range has no usable duration.');
    }

    let segmentCursor = 0;
    const firstUsableSegment =
      segments.find((segment) => {
        const segmentEnd = segmentCursor + segment.duration;
        const usable = segmentEnd > rangeStart;
        segmentCursor = segmentEnd;
        return usable;
      }) ?? segments[0];

    const targetPortrait = requestedPortrait === true;
    const rotate180 = requestedRotate180 === true;
    const mirror = requestedMirror === true;

    const rawPortrait =
      firstUsableSegment.height > firstUsableSegment.width;

    let rotationDegrees = targetPortrait === rawPortrait ? 0 : 90;
    if (rotate180) rotationDegrees = (rotationDegrees + 180) % 360;

    const quarterTurn = rotationDegrees === 90 || rotationDegrees === 270;
    const outputWidth = Math.max(
      2,
      (quarterTurn
        ? firstUsableSegment.height
        : firstUsableSegment.width) & ~1,
    );
    const outputHeight = Math.max(
      2,
      (quarterTurn
        ? firstUsableSegment.width
        : firstUsableSegment.height) & ~1,
    );

    console.log(
      '[SportReplay] MP4 orientation:',
      {
        targetPortrait,
        rawPortrait,
        rotationDegrees,
        mirror,
        outputWidth,
        outputHeight,
      },
    );

    const encoderSupport = await VideoEncoder.isConfigSupported({
      codec: 'avc1.42001f',
      width: outputWidth,
      height: outputHeight,
      bitrate: DEFAULT_BITRATE,
      framerate: 30,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    });

    if (!encoderSupport.supported) {
      throw new Error(
        'H.264 MP4 encoding is not supported by this Chrome/Edge device.',
      );
    }

    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });

    const videoSource = new VideoSampleSource({
      codec: 'avc',
      bitrate: DEFAULT_BITRATE,
      keyFrameInterval: KEY_FRAME_INTERVAL_SECONDS,
    });

    output.addVideoTrack(videoSource);
    await output.start();

    let inputTimeline = 0;
    let outputTimeline = 0;
    let frameCount = 0;
    let lastKeyFrameAt = -Infinity;

    for (const segment of segments) {
      const segmentStart = inputTimeline;
      const segmentEnd = segmentStart + segment.duration;
      inputTimeline = segmentEnd;

      if (segmentEnd <= rangeStart || segmentStart >= rangeEnd) {
        continue;
      }

      const localStart = Math.max(0, rangeStart - segmentStart);
      const localEnd = Math.min(segment.duration, rangeEnd - segmentStart);
      if (localEnd <= localStart) continue;

      const absoluteStart = segment.firstTimestamp + localStart;
      const absoluteEnd = segment.firstTimestamp + localEnd;
      const sink = new CanvasSink(segment.track, {
        width: outputWidth,
        height: outputHeight,
        fit: 'contain',
        rotation: rotationDegrees,
        alpha: false,
        poolSize: 3,
      });

      for await (const wrapped of sink.canvases(absoluteStart, absoluteEnd)) {
        const sourceRelativeTime = Math.max(
          0,
          wrapped.timestamp - absoluteStart,
        );
        const newTimestamp = outputTimeline + sourceRelativeTime;

        if (newTimestamp >= exportDuration) {
          break;
        }

        const remaining = exportDuration - newTimestamp;
        const frameDuration = Math.min(wrapped.duration, remaining);

        let sourceCanvas = wrapped.canvas;
        let mirroredCanvas = null;

        if (mirror) {
          mirroredCanvas =
            typeof OffscreenCanvas !== 'undefined'
              ? new OffscreenCanvas(outputWidth, outputHeight)
              : Object.assign(document.createElement('canvas'), {
                  width: outputWidth,
                  height: outputHeight,
                });

          const context = mirroredCanvas.getContext('2d', { alpha: false });
          context.save();
          context.translate(outputWidth, 0);
          context.scale(-1, 1);
          context.drawImage(sourceCanvas, 0, 0, outputWidth, outputHeight);
          context.restore();
          sourceCanvas = mirroredCanvas;
        }

        const sample = new VideoSample(sourceCanvas, {
          timestamp: newTimestamp,
          duration: frameDuration,
        });

        const keyFrame =
          frameCount === 0 ||
          newTimestamp - lastKeyFrameAt >= KEY_FRAME_INTERVAL_SECONDS;

        await videoSource.add(sample, { keyFrame });
        if (keyFrame) lastKeyFrameAt = newTimestamp;

        sample.close();
        frameCount += 1;
      }

      outputTimeline += Math.max(0, localEnd - localStart);
      if (outputTimeline >= exportDuration) break;
    }

    if (frameCount === 0) {
      await output.cancel();
      throw new Error('No video frames could be decoded from the selected clips.');
    }

    videoSource.close();
    await output.finalize();

    if (!target.buffer || target.buffer.byteLength === 0) {
      throw new Error('The MP4 encoder produced an empty file.');
    }

    downloadMp4(target.buffer, seconds);
    window.sportReplayLastExportError = '';
    console.log(
      `[SportReplay] MP4 ready: ${frameCount} frames, ` +
      `${target.buffer.byteLength} bytes`,
    );
    return true;
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? error.message
        : String(error);

    window.sportReplayLastExportError = message;
    console.error('[SportReplay] WebCodecs MP4 export failed:', error);
    return false;
  }
};
