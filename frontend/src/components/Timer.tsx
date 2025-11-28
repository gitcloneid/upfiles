'use client';

import { useEffect, useState } from 'react';
import type { TimerState } from '@/lib/types';

interface TimerProps {
  timer: TimerState;
  large?: boolean;
}

export function Timer({ timer, large = false }: TimerProps) {
  const [displaySeconds, setDisplaySeconds] = useState(timer.remaining_seconds);

  useEffect(() => {
    if (!timer.is_running) {
      setDisplaySeconds(timer.remaining_seconds);
      return;
    }

    const startedAt = timer.started_at ? new Date(timer.started_at).getTime() : Date.now();
    
    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = Math.max(0, timer.duration_seconds - elapsed);
      setDisplaySeconds(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [timer]);

  const hours = Math.floor(displaySeconds / 3600);
  const minutes = Math.floor((displaySeconds % 3600) / 60);
  const seconds = displaySeconds % 60;

  const formatNumber = (n: number) => n.toString().padStart(2, '0');
  const timeString = `${formatNumber(hours)}:${formatNumber(minutes)}:${formatNumber(seconds)}`;

  const isLow = displaySeconds < 300 && displaySeconds > 0;
  const isZero = displaySeconds === 0;

  return (
    <div
      className={`font-mono ${large ? 'text-6xl' : 'text-2xl'} font-bold ${
        isZero ? 'text-red-600' : isLow ? 'text-orange-500 animate-pulse' : ''
      }`}
    >
      {timeString}
    </div>
  );
}
