export const buildAudioPath = (audioKey) => `assets/audio/${audioKey}.wav`;
export const audioSourceFor = (item) => {
  const key = item?.id ?? item?.audioKey;
  return key ? buildAudioPath(key) : null;
};

let interactionRegistered = false;
let currentAudio = null;
let playbackVersion = 0;
let cancelPendingSpeech = null;
let currentSynth = null;

export function registerAudioInteraction() { interactionRegistered = true; }

export function stopStudyAudio(synth = globalThis.speechSynthesis) {
  playbackVersion += 1;
  currentAudio?.pause?.();
  currentAudio = null;
  cancelPendingSpeech?.();
  cancelPendingSpeech = null;
  try { (currentSynth ?? synth)?.cancel?.(); } catch {}
  currentSynth = null;
}

function speechTextFor(item) {
  return item?.hiragana ?? item?.kana ?? item?.katakana ?? '';
}

async function speakItem(item, options, version) {
  const text = speechTextFor(item);
  const speechFactory = options.speechFactory ?? ((value) => new SpeechSynthesisUtterance(value));
  const synth = options.speechSynthesis ?? globalThis.speechSynthesis;
  if (!text || (!options.speak && !synth?.speak)) return { ok: false, reason: 'speech-unavailable' };
  try {
    const utterance = speechFactory(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.82;
    await new Promise((resolve, reject) => {
      cancelPendingSpeech = () => reject(new Error('cancelled'));
      utterance.onend = resolve;
      utterance.onerror = (event) => reject(new Error(event?.error || 'speech-failed'));
      if (options.speak) options.speak(utterance, resolve, reject);
      else { currentSynth = synth; synth.speak(utterance); }
    });
    if (version !== playbackVersion) return { ok: false, reason: 'cancelled' };
    return { ok: true, method: 'speech' };
  } catch (error) {
    return { ok: false, reason: error?.message || error?.name || 'speech-failed' };
  } finally {
    if (version === playbackVersion) cancelPendingSpeech = null;
  }
}

export async function playStudyItem(item, options = {}) {
  if (!interactionRegistered && !options.manual) return { ok: false, reason: 'interaction-required' };
  stopStudyAudio(options.speechSynthesis);
  const version = playbackVersion;
  const source = audioSourceFor(item);
  if (source) {
    const audioFactory = options.audioFactory ?? ((path) => new Audio(path));
    try {
      const player = audioFactory(source);
      currentAudio = player;
      await player.play();
      if (version !== playbackVersion) return { ok: false, reason: 'cancelled' };
      return { ok: true, method: 'local', player };
    } catch {
      if (version !== playbackVersion) return { ok: false, reason: 'cancelled' };
      return speakItem(item, options, version);
    }
  }
  return speakItem(item, options, version);
}

export function playJapaneseKana(romaji, options = {}) {
  return playStudyItem({ romaji, hiragana: romaji, audioKey: romaji }, options);
}
