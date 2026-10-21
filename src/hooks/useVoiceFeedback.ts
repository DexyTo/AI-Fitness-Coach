import { useEffect, useRef, useState } from 'react';
import type { CoachingCue } from '../exercises/coaching';
import { VoiceScheduler } from './voiceScheduler';
import { BrowserSpeech } from './browserSpeech';

const storageKey = 'playfit-vision-voice-enabled';

export function useVoiceFeedback(active: boolean, cue: CoachingCue | null, suspended = false) {
  const supported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window;
  const [enabled, storeEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) !== 'false';
    } catch {
      return true;
    }
  });
  const [error, setError] = useState('');
  const previewing = useRef(false);
  const player = useRef<BrowserSpeech | null>(null);
  const scheduler = useRef<VoiceScheduler | null>(null);
  if (supported && !player.current) {
    player.current = new BrowserSpeech(window.speechSynthesis,
      message => new SpeechSynthesisUtterance(message), setError,
      () => { previewing.current = false; });
    scheduler.current = new VoiceScheduler(player.current);
  }
  // These functions must run directly in a click handler, before camera/model awaits.
  const testSound = () => {
    if (!supported) return;
    scheduler.current?.stop();
    previewing.current = true;
    setError('');
    storeEnabled(true);
    player.current?.speak('Голосовые подсказки включены. Во время тренировки я озвучу замечания по технике.');
  };
  const setEnabled = (value: boolean | ((previous: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(enabled) : value;
    if (next) testSound();
    else {
      previewing.current = false;
      scheduler.current?.stop();
      storeEnabled(false);
      setError('');
    }
  };

  useEffect(() => {
    if (supported) window.speechSynthesis.getVoices();
  }, [supported]);

  useEffect(() => {
    if (!active || suspended) {
      previewing.current = false;
      scheduler.current?.stop();
    }
  }, [active, suspended]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(enabled));
    } catch {
      /* Private browsing may block storage. */
    }
  }, [enabled, supported]);

  // Every fresh UI frame rechecks the current cue after the rate limit; no timeout queue.
  useEffect(() => {
    if (!previewing.current) scheduler.current?.update(active && document.visibilityState !== 'hidden', enabled && !error, cue, performance.now());
  });

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        previewing.current = false;
        scheduler.current?.stop();
      }
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
  return { enabled, setEnabled, supported, error, testSound };
}
