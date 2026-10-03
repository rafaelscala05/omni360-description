import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import type { CalendarArticle, ArticleStatus } from './types';
import { listenCalendar } from '../../services/contentService';

interface Props {
  uid: string;
  projectId: string;
  onOpenArticle: (articleId: string) => void;
}

const STATUS_DOT: Record<ArticleStatus, string> = {
  agendado: 'bg-(--ag-hairline-2)',
  em_producao: 'bg-(--ag-warn)',
  revisao: 'bg-(--ag-accent)',
  aprovado: 'bg-(--ag-ok)',
  publicado: 'bg-(--ag-accent)',
  erro: 'bg-(--ag-danger)',
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const CalendarView: React.FC<Props> = ({ uid, projectId, onOpenArticle }) => {
  const [articles, setArticles] = useState<CalendarArticle[]>([]);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  useEffect(() => listenCalendar(uid, projectId, setArticles), [uid, projectId]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarArticle[]>();
    for (const a of articles) {
      const key = a.scheduledDate;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [articles]);

  const prev = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const next = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  const totalDays = daysInMonth(year, month);
  const startOffset = firstDayOfWeek(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const todayIso = toIso(now.getFullYear(), now.getMonth(), now.getDate());

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight text-(--ag-text)">Calendário</h1>
          <p className="text-[13.5px] text-(--ag-text-2)">Visualize quando cada artigo será publicado. Clique para abrir.</p>
        </div>
      </div>

      <div className="ag-glass rounded-[22px] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-(--ag-hairline)">
          <button onClick={prev} className="p-1.5 text-(--ag-text-3) hover:text-(--ag-text) hover:bg-(--ag-fill-2) rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-(--ag-text) capitalize">{monthLabel}</span>
          <button onClick={next} className="p-1.5 text-(--ag-text-3) hover:text-(--ag-text) hover:bg-(--ag-fill-2) rounded-lg transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-(--ag-hairline)">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-[11px] font-bold text-(--ag-text-3) uppercase tracking-wider">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-(--ag-hairline) bg-(--ag-fill)/50" />
          ))}
          {Array.from({ length: totalDays }).map((_, i) => {
            const day = i + 1;
            const iso = toIso(year, month, day);
            const dayArticles = byDate.get(iso) ?? [];
            const isToday = iso === todayIso;
            return (
              <div key={day} className={`min-h-[80px] p-1.5 border-b border-r border-(--ag-hairline) ${isToday ? 'bg-(--ag-accent-soft)' : ''}`}>
                <span className={`inline-flex text-xs font-semibold mb-1 w-5 h-5 items-center justify-center rounded-full ${isToday ? 'bg-(--ag-accent) text-white' : 'text-(--ag-text-2)'}`}>{day}</span>
                <div className="space-y-0.5">
                  {dayArticles.slice(0, 3).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => onOpenArticle(a.id)}
                      className="w-full flex items-center gap-1 text-left px-1 py-0.5 rounded hover:bg-(--ag-surface-solid)/80 transition-colors group"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[a.status]}`} />
                      <span className="text-[10px] text-(--ag-text) truncate group-hover:text-(--ag-accent)">{a.titulo}</span>
                    </button>
                  ))}
                  {dayArticles.length > 3 && (
                    <span className="text-[10px] text-(--ag-text-3) pl-1">+{dayArticles.length - 3}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!articles.length && (
        <div className="text-center py-12 text-(--ag-text-3) mt-4">
          <CalendarDays className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm">Nenhum artigo agendado ainda. Gere o calendário na seção Produção de Artigos.</p>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
