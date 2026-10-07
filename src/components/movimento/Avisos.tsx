// Pilha de avisos (toasts): vidro com os tokens do Alfred, entra por baixo com
// mola, empilha, pausa o tempo enquanto o ponteiro está em cima e pode ser
// arrastado para o lado para fechar.

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { fecharAviso, inscreverAvisos, type Aviso } from '../../services/avisos';
import { useAgentTheme } from '../../modules/agent/theme';
import { vibrar } from '../../modules/agent/movimento';

const COR: Record<Aviso['tom'], string> = {
  ok: 'var(--ag-ok)',
  erro: 'var(--ag-danger, #e5484d)',
  info: 'var(--ag-blue)',
};

const Icone: React.FC<{ tom: Aviso['tom'] }> = ({ tom }) => {
  const cls = 'w-[18px] h-[18px] flex-none mt-px';
  const style = { color: COR[tom] };
  if (tom === 'ok') return <CheckCircle2 className={cls} style={style} />;
  if (tom === 'erro') return <AlertCircle className={cls} style={style} />;
  return <Info className={cls} style={style} />;
};

const ItemAviso: React.FC<{ aviso: Aviso }> = ({ aviso }) => {
  const [pausado, setPausado] = useState(false);
  const restante = useRef(aviso.duracao);
  const inicio = useRef(0);

  useEffect(() => {
    if (aviso.tom === 'erro') vibrar(20);
  }, [aviso.tom]);

  useEffect(() => {
    if (!aviso.duracao || pausado) return;
    inicio.current = Date.now();
    const t = setTimeout(() => fecharAviso(aviso.id), restante.current);
    return () => {
      clearTimeout(t);
      restante.current -= Date.now() - inicio.current;
    };
  }, [aviso.id, aviso.duracao, pausado]);

  return (
    <motion.div
      layout
      role={aviso.tom === 'erro' ? 'alert' : 'status'}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      onDragEnd={(_, info) => {
        if (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 500) fecharAviso(aviso.id);
      }}
      onPointerEnter={() => setPausado(true)}
      onPointerLeave={() => setPausado(false)}
      className="ag-glass-strong pointer-events-auto w-full rounded-2xl pl-3.5 pr-2 py-3 flex items-start gap-2.5 text-[13.5px] leading-snug cursor-grab active:cursor-grabbing"
      style={{ color: 'var(--ag-text)', borderLeft: `3px solid ${COR[aviso.tom]}` }}
    >
      <Icone tom={aviso.tom} />
      <div className="flex-1 min-w-0 whitespace-pre-line break-words">{aviso.texto}</div>
      {aviso.acao && (
        <button
          onClick={() => {
            aviso.acao!.onClick();
            fecharAviso(aviso.id);
          }}
          className="flex-none px-2.5 py-1 rounded-full text-[12.5px] font-semibold"
          style={{ background: 'var(--ag-fill-2)', color: 'var(--ag-text)' }}
        >
          {aviso.acao.rotulo}
        </button>
      )}
      <button
        onClick={() => fecharAviso(aviso.id)}
        aria-label="Fechar aviso"
        className="flex-none w-7 h-7 -my-1 rounded-full flex items-center justify-center"
        style={{ color: 'var(--ag-text-2)' }}
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
};

const Avisos: React.FC = () => {
  const { tema } = useAgentTheme();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  useEffect(() => inscreverAvisos(setAvisos), []);

  return (
    <div
      className="alfreds fixed z-[200] left-3 right-3 sm:left-auto sm:right-5 sm:w-[380px] flex flex-col-reverse gap-2 pointer-events-none"
      data-tema={tema}
      style={{ bottom: 'calc(5.75rem + env(safe-area-inset-bottom, 0px))', background: 'transparent' }}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {avisos.map((a) => (
          <ItemAviso key={a.id} aviso={a} />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default Avisos;
