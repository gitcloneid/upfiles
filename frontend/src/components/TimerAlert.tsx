'use client';

import { useEffect, useRef, useState } from 'react';
import type { TimerState } from '@/lib/types';

interface TimerAlertProps {
  timer: TimerState;
  enabled?: boolean;
}

export function useTimerAlert(timer: TimerState, enabled: boolean = true) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const [alertedAt, setAlertedAt] = useState<Set<number>>(new Set());

  const playBeep = (frequency: number = 800, duration: number = 200, times: number = 1) => {
    if (!enabled) return;
    
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      
      const ctx = audioContextRef.current;
      
      const playOnce = (delay: number) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, ctx.currentTime + delay);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + duration / 1000);
        
        oscillator.start(ctx.currentTime + delay);
        oscillator.stop(ctx.currentTime + delay + duration / 1000);
      };
      
      for (let i = 0; i < times; i++) {
        playOnce(i * 0.3);
      }
    } catch (e) {
      console.error('Audio not supported:', e);
    }
  };

  useEffect(() => {
    if (!enabled || !timer.is_running) return;

    const remaining = timer.remaining_seconds;
    
    // 5 minutes warning
    if (remaining === 300 && !alertedAt.has(300)) {
      playBeep(600, 300, 2);
      setAlertedAt(prev => new Set(prev).add(300));
    }
    
    // 1 minute warning
    if (remaining === 60 && !alertedAt.has(60)) {
      playBeep(800, 300, 3);
      setAlertedAt(prev => new Set(prev).add(60));
    }
    
    // 30 seconds warning
    if (remaining === 30 && !alertedAt.has(30)) {
      playBeep(900, 200, 2);
      setAlertedAt(prev => new Set(prev).add(30));
    }
    
    // 10 seconds countdown
    if (remaining <= 10 && remaining > 0 && !alertedAt.has(remaining)) {
      playBeep(1000, 100, 1);
      setAlertedAt(prev => new Set(prev).add(remaining));
    }
    
    // Time's up!
    if (remaining === 0 && !alertedAt.has(0)) {
      playBeep(1200, 500, 5);
      setAlertedAt(prev => new Set(prev).add(0));
    }
  }, [timer.remaining_seconds, timer.is_running, enabled, alertedAt]);

  // Reset alerts when timer is reset
  useEffect(() => {
    if (timer.remaining_seconds === timer.duration_seconds) {
      setAlertedAt(new Set());
    }
  }, [timer.remaining_seconds, timer.duration_seconds]);

  return { playBeep };
}

export function TimerAlert({ timer, enabled = true }: TimerAlertProps) {
  useTimerAlert(timer, enabled);
  return null;
}
