export const buildAudioPath = (audioKey) => `assets/audio/${audioKey}.mp3`;
export const audioSourceFor = (item) => item?.audioKey ? buildAudioPath(item.audioKey) : null;

let interactionRegistered = false;
let currentAudio = null;

export function registerAudioInteraction() { interactionRegistered = true; }

function speechTextFor(item) {
  return item?.hiragana ?? item?.kana ?? item?.katakana ?? '';
}

async function speakItem(item, options) {
  const text = speechTextFor(item);
  const speechFactory = options.speechFactory ?? ((value) => new SpeechSynthesisUtterance(value));
  const synth = options.speechSynthesis ?? globalThis.speechSynthesis;
  if (!text || (!options.speak && !synth?.speak)) return { ok: false, reason: 'speech-unavailable' };
  try {
    const utterance = speechFactory(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.82;
    await new Promise((resolve, reject) => {
      utterance.onend = resolve;
      utterance.onerror = (event) => reject(new Error(event?.error || 'speech-failed'));
      if (options.speak) options.speak(utterance, resolve, reject);
      else { synth.cancel?.(); synth.speak(utterance); }
    });
    return { ok: true, method: 'speech' };
  } catch (error) {
    return { ok: false, reason: error?.message || error?.name || 'speech-failed' };
  }
}

export async function playStudyItem(item, options = {}) {
  if (!interactionRegistered && !options.manual) return { ok: false, reason: 'interaction-required' };
  const source = audioSourceFor(item);
  if (source) {
    const audioFactory = options.audioFactory ?? ((path) => new Audio(path));
    try {
      if (currentAudio?.pause) currentAudio.pause();
      const player = audioFactory(source);
      currentAudio = player;
      await player.play();
      return { ok: true, method: 'local', player };
    } catch {
      return speakItem(item, options);
    }
  }
  return speakItem(item, options);
}

export function playJapaneseKana(romaji, options = {}) {
  return playStudyItem({ romaji, hiragana: romaji, audioKey: romaji }, options);
}
