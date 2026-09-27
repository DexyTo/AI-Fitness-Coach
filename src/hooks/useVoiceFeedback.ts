import { useEffect, useRef, useState } from 'react';
import type { ExerciseFeedback } from '../exercises/types';

const storageKey = 'ai-fitness-coach-voice-enabled';

export function useVoiceFeedback(active: boolean, feedback?: ExerciseFeedback) {
  const supported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window;
  const [enabled, setEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) !== 'false';
    } catch {
      return true;
    }
  });
  const lastSpoken = useRef<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(enabled));
    } catch {
      /* Private browsing may block storage. */
    }
    if (!enabled) {
      lastSpoken.current = null;
      if (supported) window.speechSynthesis.cancel();
    }
  }, [enabled, supported]);

  useEffect(() => {
    if (!active) {
      lastSpoken.current = null;
      if (supported) window.speechSynthesis.cancel();
      return;
    }
    if (!feedback) {
      lastSpoken.current = null;
      return;
    }
    if (!enabled || !supported || lastSpoken.current === feedback.code) return;
    lastSpoken.current = feedback.code;
    const utterance = new SpeechSynthesisUtterance(feedback.message);
    utterance.lang = 'ru-RU';
    utterance.rate = 0.95;
    const russianVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().startsWith('ru'));
    if (russianVoice) utterance.voice = russianVoice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [active, enabled, feedback?.code, feedback?.message, supported]);

  useEffect(
    () => () => {
      if (supported) window.speechSynthesis.cancel();
    },
    [supported],
  );
  return { enabled, setEnabled, supported };
}
