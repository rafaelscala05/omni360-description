import React, { useLayoutEffect, useState } from 'react';

interface TutorialSpotlightProps {
  targetId: string;
  message: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const TutorialSpotlight: React.FC<TutorialSpotlightProps> = ({ targetId, message }) => {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector(`[data-tour="${targetId}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const domRect = el.getBoundingClientRect();
      setRect({ top: domRect.top, left: domRect.left, width: domRect.width, height: domRect.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [targetId]);

  if (!rect) return null;

  const padding = 4;
  const holeTop = rect.top - padding;
  const holeLeft = rect.left - padding;
  const holeWidth = rect.width + padding * 2;
  const holeHeight = rect.height + padding * 2;
  const holeBottom = holeTop + holeHeight;
  const holeRight = holeLeft + holeWidth;

  const spaceBelow = window.innerHeight - holeBottom;
  const tooltipBelow = spaceBelow > 90;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" aria-hidden="true">
      <div className="fixed bg-black/60 pointer-events-auto" style={{ top: 0, left: 0, right: 0, height: Math.max(holeTop, 0) }} />
      <div className="fixed bg-black/60 pointer-events-auto" style={{ top: holeBottom, left: 0, right: 0, bottom: 0 }} />
      <div className="fixed bg-black/60 pointer-events-auto" style={{ top: holeTop, left: 0, width: Math.max(holeLeft, 0), height: holeHeight }} />
      <div className="fixed bg-black/60 pointer-events-auto" style={{ top: holeTop, left: holeRight, right: 0, height: holeHeight }} />

      <div
        className="fixed border-2 border-[#FF5B03] rounded-lg animate-pulse pointer-events-none"
        style={{ top: holeTop, left: holeLeft, width: holeWidth, height: holeHeight }}
      />

      <div
        className="fixed bg-slate-900 text-white text-sm font-medium rounded-lg px-4 py-2.5 shadow-xl pointer-events-none max-w-xs"
        style={
          tooltipBelow
            ? { top: holeBottom + 12, left: holeLeft }
            : { top: holeTop - 12, left: holeLeft, transform: 'translateY(-100%)' }
        }
      >
        {message}
      </div>
    </div>
  );
};

export default TutorialSpotlight;
