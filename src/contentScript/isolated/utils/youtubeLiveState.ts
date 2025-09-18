const LIVE_EDGE_THRESHOLD_SECONDS = 5;
const MINIMUM_DVR_WINDOW_SECONDS = 15;

const MOVIE_PLAYER_ID = "movie_player";

type YoutubePlayer = {
  getVideoData?: () => {isLive?: boolean, isLiveContent?: boolean} | undefined,
  getProgressState?: () => any,
  getCurrentTime?: () => number,
  getLiveState?: () => string,
  getAvailablePlaybackRates?: () => number[],
};

type PlaybackMetrics = {
  currentTime?: number,
  liveEdge?: number,
  hasDvr?: boolean,
};

export function shouldEnforceNormalSpeedOnYoutubeLive(video: HTMLVideoElement): boolean {
  const player = getYoutubePlayer();
  return isLiveContent(player, video);
}

function getYoutubePlayer(): YoutubePlayer | undefined {
  const fromDom = document.getElementById(MOVIE_PLAYER_ID);
  if (fromDom) return fromDom as unknown as YoutubePlayer;

  const appContext = (window as any)?.ytPlayerApplicationContext?.player;
  if (appContext) return appContext as YoutubePlayer;

  const legacyPlayer = (window as any)?.ytplayer?.app?.player;
  if (legacyPlayer) return legacyPlayer as YoutubePlayer;

  return undefined;
}

function isLiveContent(player: YoutubePlayer | undefined, video: HTMLVideoElement): boolean {
  const signals: Array<boolean | undefined> = [
    safeBoolean(() => player?.getVideoData?.()?.isLive),
    safeBoolean(() => player?.getVideoData?.()?.isLiveContent),
    interpretLiveState(safeCall(() => player?.getLiveState?.())),
    readInitialPlayerResponse(),
    readDomIndicators(),
  ];

  let sawFalse = false;
  for (const signal of signals) {
    if (signal === true) return true;
    if (signal === false) sawFalse = true;
  }

  if (sawFalse) return false;

  if (video.duration === Infinity) {
    return true;
  }

  return false;
}

function getPlaybackMetrics(player: YoutubePlayer | undefined, video: HTMLVideoElement): PlaybackMetrics {
  const progressState = safeCall(() => player?.getProgressState?.());
  const currentTime = pickNumber(safeCall(() => player?.getCurrentTime?.()), video.currentTime);

  const liveEdge = pickNumber(
    extractSeekableEnd(progressState),
    getVideoSeekableEnd(video),
  );

  const hasDvr = detectDvrEnabled(progressState, video, liveEdge);

  return {currentTime, liveEdge, hasDvr};
}

function detectDvrEnabled(progressState: any, video: HTMLVideoElement, seekableEnd?: number): boolean | undefined {
  const explicit = progressState?.hasDvr;
  if (typeof explicit === "boolean") {
    return explicit;
  }

  const seekableStart = pickNumber(
    progressState?.seekableStart,
    progressState?.seekableRangeStart,
    getVideoSeekableStart(video),
  );

  if (
    seekableStart != null &&
    seekableEnd != null &&
    Number.isFinite(seekableStart) &&
    Number.isFinite(seekableEnd)
  ) {
    const windowLength = seekableEnd - seekableStart;
    if (!Number.isNaN(windowLength)) {
      return windowLength >= MINIMUM_DVR_WINDOW_SECONDS;
    }
  }

  return undefined;
}

function extractSeekableEnd(progressState: any): number | undefined {
  if (!progressState) return undefined;

  const renderer = progressState?.liveStreamability?.liveStreamabilityRenderer;
  const liveStreamability = renderer?.liveStreamability;

  const candidates = [
    progressState.seekableEnd,
    progressState.seekableRangeEnd,
    normalizeMilliseconds(liveStreamability?.endTimestampMs),
    normalizeMilliseconds(renderer?.endTimestampMs),
  ];

  return pickNumber(...candidates);
}

function normalizeMilliseconds(value: any): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return value / 1000;
}

function getVideoSeekableEnd(video: HTMLVideoElement): number | undefined {
  const seekable = video.seekable;
  if (!seekable?.length) return undefined;

  try {
    return seekable.end(seekable.length - 1);
  } catch (err) {
    return undefined;
  }
}

function getVideoSeekableStart(video: HTMLVideoElement): number | undefined {
  const seekable = video.seekable;
  if (!seekable?.length) return undefined;

  try {
    return seekable.start(0);
  } catch (err) {
    return undefined;
  }
}

function readInitialPlayerResponse(): boolean | undefined {
  const response = getInitialPlayerResponse();
  if (!response) return undefined;

  const details = response.videoDetails;
  if (details) {
    if (typeof details.isLive === "boolean") return details.isLive;
    if (typeof details.isLiveContent === "boolean") return details.isLiveContent;
  }

  const microformat = response.microformat?.playerMicroformatRenderer;
  if (microformat?.liveBroadcastDetails) {
    const liveNow = microformat.liveBroadcastDetails.isLiveNow;
    if (typeof liveNow === "boolean") return liveNow;

    const startTimestamp = microformat.liveBroadcastDetails.startTimestamp;
    if (typeof startTimestamp === "string") {
      const parsed = Date.parse(startTimestamp);
      if (!Number.isNaN(parsed)) {
        const now = Date.now();
        if (parsed <= now) {
          return true;
        }
      }
    }
  }

  return undefined;
}

function getInitialPlayerResponse(): any {
  const direct = (window as any)?.ytInitialPlayerResponse;
  if (direct && typeof direct === "object") {
    return direct;
  }

  const config = (window as any)?.ytplayer?.config;
  const args = config?.args;
  const response = args?.player_response;
  if (typeof response === "string") {
    try {
      return JSON.parse(response);
    } catch (err) {
      return undefined;
    }
  }

  if (response && typeof response === "object") {
    return response;
  }

  return undefined;
}

function readDomIndicators(): boolean | undefined {
  const flexy = document.querySelector("ytd-watch-flexy");
  if (flexy) {
    if (flexy.hasAttribute("is-live-stream") || flexy.hasAttribute("is-live-content")) {
      return true;
    }
  }

  const player = document.querySelector("ytd-player");
  if (player) {
    if ((player as HTMLElement).hasAttribute("is-live-stream")) return true;
  }

  const liveMeta = document.querySelector("meta[itemprop='isLiveBroadcast']");
  if (liveMeta) {
    const content = liveMeta.getAttribute("content");
    if (typeof content === "string") {
      const normalized = content.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }

  const liveBadge = document.querySelector(".ytp-live-badge");
  if (liveBadge instanceof HTMLElement) {
    const display = window.getComputedStyle(liveBadge).display;
    if (display && display.toLowerCase() !== "none") {
      return true;
    }
  }

  return undefined;
}

function interpretLiveState(liveState: string | undefined): boolean | undefined {
  if (typeof liveState !== "string") return undefined;

  const normalized = liveState.toUpperCase();
  if (normalized === "LIVE_ON" || normalized === "LIVE_STREAM_ACTIVE" || normalized === "DVR") {
    return true;
  }

  if (normalized === "NONE" || normalized === "NOT_LIVE" || normalized === "LIVE_STREAM_OFFLINE") {
    return false;
  }

  return undefined;
}

function safeBoolean(fn: () => boolean | undefined): boolean | undefined {
  const value = safeCall(fn);
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function pickNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && !Number.isNaN(value)) {
      return value;
    }
  }
  return undefined;
}

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    return undefined;
  }
}
