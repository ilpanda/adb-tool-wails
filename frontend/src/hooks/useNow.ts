import {useEffect, useState} from 'react';

// active 为 true 时按 interval 刷新当前时间，用于展示实时计时
export function useNow(active: boolean, interval = 100): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), interval);
        return () => window.clearInterval(timer);
    }, [active, interval]);
    return now;
}
