import { useEffect, useState } from 'react';
import { isoDate } from './format.js';
import { watchLocalDay } from './live-refresh.js';
export function useToday() {
  const [today,setToday]=useState(()=>isoDate());
  useEffect(()=>watchLocalDay(setToday),[]);
  return today;
}
