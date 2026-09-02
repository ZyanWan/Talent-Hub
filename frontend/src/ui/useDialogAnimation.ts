import { useEffect, useRef, useState } from "react";

// 模态框开合动画状态机（rAF 加 .is-visible 的时序）：
// - 打开：先挂载（首帧无 .is-visible，opacity/位移为初态），下一帧再加
//   .is-visible，触发 CSS transition 播放入场动画；
// - 关闭：先移除 .is-visible 播放离场动画，动画时长后卸载 DOM。
// closeDelayMs 应不小于目标对话框的 CSS transition 时长。
export function useDialogAnimation(open: boolean, closeDelayMs = 300) {
    const [mounted, setMounted] = useState(open);
    const [visible, setVisible] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (open) {
            setMounted(true);
            let raf2 = 0;
            const raf1 = requestAnimationFrame(() => {
                raf2 = requestAnimationFrame(() => setVisible(true));
            });
            return () => {
                cancelAnimationFrame(raf1);
                if (raf2) cancelAnimationFrame(raf2);
            };
        }
        setVisible(false);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setMounted(false), closeDelayMs);
        return () => {
            if (timer.current) clearTimeout(timer.current);
        };
    }, [open, closeDelayMs]);

    return { mounted, visible };
}
