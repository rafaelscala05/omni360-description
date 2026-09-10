// Escolhe o renderizador pela largura da viewport. O estado da missão vive
// acima dos dois, então redimensionar a janela troca o layout sem perder nada.

import React, { useEffect, useState } from 'react';
import MissionChat, { type RendererProps } from './MissionChat';
import MissionSplit from './MissionSplit';

const BREAKPOINT = 768;

export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= BREAKPOINT : true,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${BREAKPOINT}px)`);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

const MissionRunner: React.FC<RendererProps> = (props) => {
  const desktop = useIsDesktop();
  return (
    <div className="min-h-screen bg-[#f7f9fb]">
      {desktop ? <MissionSplit {...props} /> : <MissionChat {...props} />}
    </div>
  );
};

export default MissionRunner;
