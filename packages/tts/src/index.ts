export type { ProviderTimings, TimedSpan, TimingUnit, TtsCapabilities, TtsProvider, TtsRequest, TtsResult } from "./provider.js";
export { align } from "./align.js";
export { MockTtsProvider, type MockOptions } from "./mock.js";
export { FileCache, MemoryCache, sceneText, speakScene, speakVideo, speechKey, type CachedSpeech, type SpeakOptions, type SpeechCache } from "./speak.js";
export { wav, wavDuration } from "./wav.js";
