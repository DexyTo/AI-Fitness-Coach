import { useEffect, useRef, useState } from 'react';
import type { CoachingCue } from '../exercises/coaching';
import { VoiceScheduler } from './voiceScheduler';

const storageKey = 'playfit-vision-voice-enabled';

export function useVoiceFeedback(active: boolean, cue: CoachingCue | null) {
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
  const scheduler = useRef<VoiceScheduler | null>(null);
  if (supported && !scheduler.current) scheduler.current = new VoiceScheduler({
    cancel: () => window.speechSynthesis.cancel(),
    speak: message => {
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'ru-RU';
      utterance.rate = 0.95;
      const voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith('ru'));
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    },
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(enabled));
    } catch {
      /* Private browsing may block storage. */
    }
  }, [enabled, supported]);

  // Every fresh UI frame rechecks the current cue after the rate limit; no timeout queue.
  useEffect(() => {
    scheduler.current?.update(active && document.visibilityState !== 'hidden', enabled, cue, performance.now());
  });

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') scheduler.current?.update(false, enabled, null, performance.now());
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [enabled]);

  useEffect(
    () => () => {
      scheduler.current?.stop();
    },
    [supported],
  );
  return { enabled, setEnabled, supported };
}
