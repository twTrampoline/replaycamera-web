import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
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
    const trimFromStart = Math.max(0, totalDuration - seconds);
    const exportDuration = Math.min(seconds, totalDuration);

    if (exportDuration <= 0) {
      throw new Error('The selected recording has no usable duration.');
    }

    const firstUsableSegment =
      segments.find((segment, index) => {
        const before = segments
          .slice(0, index)
          .reduce((sum, value) => sum + value.duration, 0);
        return before + segment.duration > trimFromStart;
      }) ?? segments[0];

    const encoderSupport = await VideoEncoder.isConfigSupported({
      codec: 'avc1.42001f',
      width: Math.max(2, firstUsableSegment.width & ~1),
      height: Math.max(2, firstUsableSegment.height & ~1),
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

      if (segmentEnd <= trimFromStart) {
        continue;
      }

      const localTrim = Math.max(0, trimFromStart - segmentStart);
      const absoluteStart = segment.firstTimestamp + localTrim;
      const absoluteEnd = segment.firstTimestamp + segment.duration;
      const sink = new VideoSampleSink(segment.track);

      for await (const sample of sink.samples(absoluteStart, absoluteEnd)) {
        const sourceRelativeTime = Math.max(
          0,
          sample.timestamp - absoluteStart,
        );
        const newTimestamp = outputTimeline + sourceRelativeTime;

        if (newTimestamp >= exportDuration) {
          sample.close();
          break;
        }

        sample.setTimestamp(newTimestamp);

        const remaining = exportDuration - newTimestamp;
        if (sample.duration > remaining) {
          sample.setDuration(remaining);
        }

        const keyFrame =
          frameCount === 0 ||
          newTimestamp - lastKeyFrameAt >= KEY_FRAME_INTERVAL_SECONDS;

        await videoSource.add(sample, { keyFrame });
        if (keyFrame) lastKeyFrameAt = newTimestamp;

        sample.close();
        frameCount += 1;
      }

      outputTimeline += Math.max(0, segment.duration - localTrim);
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
