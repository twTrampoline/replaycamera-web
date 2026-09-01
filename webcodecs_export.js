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
const OUTPUT_FPS = 30;
const FRAME_DURATION = 1 / OUTPUT_FPS;
const KEY_FRAME_INTERVAL_SECONDS = 2;

/**
 * Returns the primary video track and its real duration.
 *
 * Mediabunny's computeDuration() returns the track END timestamp, not the
 * elapsed duration. MediaRecorder WebM streams may begin at a non-zero
 * timestamp, so always subtract getFirstTimestamp().
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
  const endTimestamp = await track.computeDuration();
  const duration = Math.max(0, endTimestamp - firstTimestamp);
  const width = await track.getDisplayWidth();
  const height = await track.getDisplayHeight();

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('A selected recording segment has no usable duration.');
  }
  if (!width || !height) {
    throw new Error('A selected recording segment has invalid video dimensions.');
  }

  return {
    blob,
    input,
    track,
    firstTimestamp,
    endTimestamp,
    duration,
    width,
    height,
  };
}

async function chooseCompatibleAvcCodec(width, height) {
  // Fixed 30 fps plus an explicit AVC profile/level avoids MP4 files that some
  // system players misread as 0:00 or 32x32. Level 4.0 safely covers 720p30 in
  // either portrait or landscape orientation.
  const candidates = [
    'avc1.42e028', // Constrained Baseline, Level 4.0 (widest compatibility)
    'avc1.4d4028', // Main, Level 4.0
    'avc1.640028', // High, Level 4.0
    'avc1.42e01f', // Constrained Baseline, Level 3.1 fallback
  ];

  for (const codec of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: DEFAULT_BITRATE,
        framerate: OUTPUT_FPS,
        latencyMode: 'quality',
        hardwareAcceleration: 'no-preference',
        avc: { format: 'avc' },
      });
      if (support.supported) return codec;
    } catch (_) {
      // Try the next AVC profile.
    }
  }

  throw new Error('H.264 MP4 encoding is not supported by this Chrome/Edge device.');
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

  // Safari/Chrome may still be reading the object URL after the click handler
  // returns. Keep it alive long enough for the download to finish reliably.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function validateMp4(buffer, expectedDuration, expectedWidth, expectedHeight) {
  const blob = new Blob([buffer], { type: 'video/mp4' });
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('The generated MP4 has no video track.');

  const firstTimestamp = await track.getFirstTimestamp();
  const endTimestamp = await track.computeDuration();
  const duration = Math.max(0, endTimestamp - firstTimestamp);
  const width = await track.getDisplayWidth();
  const height = await track.getDisplayHeight();

  if (!Number.isFinite(duration) || duration < Math.min(0.5, expectedDuration * 0.5)) {
    throw new Error(`The generated MP4 has an invalid duration (${duration}s).`);
  }
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `The generated MP4 has invalid dimensions (${width}x${height}, expected ` +
      `${expectedWidth}x${expectedHeight}).`,
    );
  }
  if (!(await track.canDecode())) {
    throw new Error('The generated MP4 cannot be decoded by this browser.');
  }

  return { duration, width, height };
}

/**
 * Converts cached WebM recording segments into a genuine, broadly compatible
 * H.264 MP4. The output is rebuilt on a fixed 30 fps timeline. This is
 * deliberate: directly carrying MediaRecorder's irregular timestamps into MP4
 * can create files that VLC plays but QuickTime/Windows/Photos report as 0:00
 * or refuse to open.
 */
window.sportReplayExportMp4Blobs = async function sportReplayExportMp4Blobs(
  blobLike,
  requestedSeconds,
  requestedRangeStart,
  requestedRangeEnd,
  requestedPortrait,
  requestedRotationQuarterTurns,
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

    console.log('[SportReplay] Inspecting recording segments…');
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

    let requestedStartNumber = Number(requestedRangeStart);
    let requestedEndNumber = Number(requestedRangeEnd);
    if (!Number.isFinite(requestedStartNumber)) requestedStartNumber = 0;

    // A standalone MediaRecorder WebM can begin at a non-zero cluster
    // timestamp. Accept both absolute recorder timestamps and elapsed offsets.
    if (segments.length === 1 && segments[0].firstTimestamp > 0) {
      const first = segments[0].firstTimestamp;
      const last = segments[0].endTimestamp;
      const looksAbsolute =
        requestedStartNumber >= first - 0.25 &&
        Number.isFinite(requestedEndNumber) &&
        requestedEndNumber <= last + 0.25;
      if (looksAbsolute) {
        requestedStartNumber -= first;
        requestedEndNumber -= first;
      }
    }

    const rangeStart = Math.max(
      0,
      Math.min(totalDuration, requestedStartNumber),
    );
    const fallbackEnd = rangeStart + seconds;
    const rangeEnd = Math.max(
      rangeStart,
      Math.min(
        totalDuration,
        Number.isFinite(requestedEndNumber) ? requestedEndNumber : fallbackEnd,
      ),
    );
    const exportDuration = Math.min(seconds, rangeEnd - rangeStart);

    if (!Number.isFinite(exportDuration) || exportDuration <= 0) {
      throw new Error('The selected recording range has no usable duration.');
    }

    let segmentCursor = 0;
    let firstUsableSegment = segments[0];
    for (const segment of segments) {
      const segmentEnd = segmentCursor + segment.duration;
      if (segmentEnd > rangeStart) {
        firstUsableSegment = segment;
        break;
      }
      segmentCursor = segmentEnd;
    }

    const targetPortrait = requestedPortrait === true;
    const rotationQuarterTurns =
      ((Math.trunc(Number(requestedRotationQuarterTurns) || 0) % 4) + 4) % 4;
    const mirror = requestedMirror === true;
    const rawPortrait = firstUsableSegment.height > firstUsableSegment.width;

    let rotationDegrees = targetPortrait === rawPortrait ? 0 : 90;
    rotationDegrees = (rotationDegrees + rotationQuarterTurns * 90) % 360;

    const quarterTurn = rotationDegrees === 90 || rotationDegrees === 270;
    const outputWidth = Math.max(
      2,
      (quarterTurn ? firstUsableSegment.height : firstUsableSegment.width) & ~1,
    );
    const outputHeight = Math.max(
      2,
      (quarterTurn ? firstUsableSegment.width : firstUsableSegment.height) & ~1,
    );
    const fullCodecString = await chooseCompatibleAvcCodec(
      outputWidth,
      outputHeight,
    );

    console.log('[SportReplay] MP4 output config:', {
      exportDuration,
      outputWidth,
      outputHeight,
      fps: OUTPUT_FPS,
      fullCodecString,
      rotationDegrees,
      mirror,
    });

    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });
    const videoSource = new VideoSampleSource({
      codec: 'avc',
      fullCodecString,
      bitrate: DEFAULT_BITRATE,
      bitrateMode: 'variable',
      latencyMode: 'quality',
      hardwareAcceleration: 'no-preference',
      keyFrameInterval: KEY_FRAME_INTERVAL_SECONDS,
      onEncoderConfig: (config) => {
        console.log('[SportReplay] Active H.264 encoder config:', config);
      },
    });

    output.addVideoTrack(videoSource);
    await output.start();

    // Build a constant-frame-rate plan first, then batch each segment's frame
    // requests through canvasesAtTimestamps(). This gives monotonic timestamps
    // and exact sample durations without repeatedly seeking for every frame.
    const frameTotal = Math.max(1, Math.ceil(exportDuration * OUTPUT_FPS));
    const plansBySegment = segments.map(() => []);
    let cursor = 0;

    for (let frameIndex = 0; frameIndex < frameTotal; frameIndex += 1) {
      const outputTimestamp = frameIndex * FRAME_DURATION;
      if (outputTimestamp >= exportDuration) break;

      const sourceOffset =
        frameIndex === frameTotal - 1
          ? Math.max(0, exportDuration - 0.000001)
          : Math.min(
              Math.max(0, exportDuration - 0.000001),
              outputTimestamp + FRAME_DURATION / 2,
            );
      const sourceTimeline = rangeStart + sourceOffset;

      cursor = 0;
      let segmentIndex = segments.length - 1;
      let localTimestamp = segments[segmentIndex].duration;
      for (let i = 0; i < segments.length; i += 1) {
        const next = cursor + segments[i].duration;
        if (sourceTimeline < next || i === segments.length - 1) {
          segmentIndex = i;
          localTimestamp = Math.max(
            0,
            Math.min(segments[i].duration - 0.000001, sourceTimeline - cursor),
          );
          break;
        }
        cursor = next;
      }

      plansBySegment[segmentIndex].push({
        frameIndex,
        outputTimestamp,
        duration: Math.min(FRAME_DURATION, exportDuration - outputTimestamp),
        sourceTimestamp:
          segments[segmentIndex].firstTimestamp + localTimestamp,
      });
    }

    let frameCount = 0;
    let mirroredCanvas = null;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const plans = plansBySegment[segmentIndex];
      if (plans.length === 0) continue;

      const segment = segments[segmentIndex];
      const sink = new CanvasSink(segment.track, {
        width: outputWidth,
        height: outputHeight,
        fit: 'contain',
        rotation: rotationDegrees,
        alpha: false,
        poolSize: 3,
      });
      const timestamps = plans.map((plan) => plan.sourceTimestamp);
      let planIndex = 0;

      for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
        const plan = plans[planIndex];
        planIndex += 1;
        if (!plan) break;
        if (!wrapped) {
          throw new Error(`Unable to decode export frame ${plan.frameIndex + 1}.`);
        }

        let sourceCanvas = wrapped.canvas;
        if (mirror) {
          if (!mirroredCanvas) {
            mirroredCanvas =
              typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(outputWidth, outputHeight)
                : Object.assign(document.createElement('canvas'), {
                    width: outputWidth,
                    height: outputHeight,
                  });
          }
          const context = mirroredCanvas.getContext('2d', { alpha: false });
          context.save();
          context.fillStyle = '#000';
          context.fillRect(0, 0, outputWidth, outputHeight);
          context.translate(outputWidth, 0);
          context.scale(-1, 1);
          context.drawImage(sourceCanvas, 0, 0, outputWidth, outputHeight);
          context.restore();
          sourceCanvas = mirroredCanvas;
        }

        const sample = new VideoSample(sourceCanvas, {
          timestamp: plan.outputTimestamp,
          duration: Math.max(0.000001, plan.duration),
        });
        const keyFrame =
          frameCount === 0 ||
          frameCount % (OUTPUT_FPS * KEY_FRAME_INTERVAL_SECONDS) === 0;

        await videoSource.add(sample, { keyFrame });
        sample.close();
        frameCount += 1;
      }

      if (planIndex !== plans.length) {
        throw new Error('The decoder returned fewer frames than requested.');
      }
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

    const validation = await validateMp4(
      target.buffer,
      exportDuration,
      outputWidth,
      outputHeight,
    );

    downloadMp4(target.buffer, seconds);
    window.sportReplayLastExportError = '';
    console.log('[SportReplay] MP4 ready:', {
      frameCount,
      bytes: target.buffer.byteLength,
      duration: validation.duration,
      width: validation.width,
      height: validation.height,
    });
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
