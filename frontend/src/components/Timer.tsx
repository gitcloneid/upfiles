'use client';

import { useEffect, useState, useRef } from 'react';
import type { TimerState } from '@/lib/types';

interface TimerProps {
  timer: TimerState;
  large?: boolean;
}

export function Timer({ timer, large = false }: TimerProps) {
  const [displaySeconds, setDisplaySeconds] = useState(timer.remaining_seconds);
  const lastServerTime = useRef(timer.remaining_seconds);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    // Selalu sync dengan server state
    lastServerTime.current = timer.remaining_seconds;
    
    if (!timer.is_running) {
      setDisplaySeconds(timer.remaining_seconds);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const startedAt = timer.started_at ? new Date(timer.started_at).getTime() : Date.now();
    
    // Gunakan requestAnimationFrame untuk update lebih smooth
    const updateTimer = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - startedAt) / 1000);
      const remaining = Math.max(0, timer.duration_seconds - elapsed);
      setDisplaySeconds(remaining);
      
      if (remaining > 0) {
        animationRef.current = requestAnimationFrame(updateTimer);
      }
    };

    // Update segera
    updateTimer();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [timer.is_running, timer.started_at, timer.duration_seconds, timer.remaining_seconds]);

  const hours = Math.floor(displaySeconds / 3600);
  const minutes = Math.floor((displaySeconds % 3600) / 60);
  const seconds = displaySeconds % 60;

  const formatNumber = (n: number) => n.toString().padStart(2, '0');
  const timeString = `${formatNumber(hours)}:${formatNumber(minutes)}:${formatNumber(seconds)}`;

  const isLow = displaySeconds < 300 && displaySeconds > 0;
  const isZero = displaySeconds === 0;

  return (
    <div
      className={`font-mono ${large ? 'text-6xl' : 'text-2xl'} font-bold tabular-nums ${
        isZero ? 'text-red-600' : isLow ? 'text-orange-500 animate-pulse' : ''
      }`}
    >
      {timeString}
    </div>
  );
}
