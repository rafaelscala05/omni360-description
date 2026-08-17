import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Paperclip, Square, X } from 'lucide-react';
import type { ThreadAttachment } from '../../types/agent';
import { uploadAnexo } from '../../services/operationsService';

interface Props {
  disabled: boolean;
  streaming: boolean;
  onEnviar: (texto: string, anexos: ThreadAttachment[]) => void;
  onParar: () => void;
  placeholder?: string;
}

const Composer: React.FC<Props> = ({ disabled, streaming, onEnviar, onParar, placeholder }) => {
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState<ThreadAttachment[]>([]);
  const [subindo, setSubindo] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Cresce com o conteúdo até um teto, como no Claude.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [texto]);

  const subirArquivos = async (files: FileList | File[]) => {
    const lista = Array.from(files).slice(0, 5);
    if (!lista.length) return;
    setErro(null);
    setSubindo((n) => n + lista.length);
    for (const f of lista) {
      try {
        const anexo = await uploadAnexo(f);
        setAnexos((prev) => [...prev, anexo]);
      } catch (e: any) {
        setErro(e?.message ?? 'Falha ao enviar o arquivo.');
      } finally {
        setSubindo((n) => n - 1);
      }
    }
  };

  const enviar = () => {
    if (disabled || streaming || subindo > 0) return;
    if (!texto.trim() && !anexos.length) return;
    onEnviar(texto.trim(), anexos);
    setTexto('');
    setAnexos([]);
  };

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        {erro && <div className="mb-2 text-xs text-red-600">{erro}</div>}

        <div
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            if (e.dataTransfer.files?.length) void subirArquivos(e.dataTransfer.files);
          }}
          className={`rounded-2xl border bg-white shadow-sm transition-colors ${arrastando ? 'border-[#FF5B03] ring-2 ring-[#FF5B03]/15' : 'border-slate-200 focus-within:border-slate-300'}`}
        >
          {(anexos.length > 0 || subindo > 0) && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {anexos.map((a) => (
                <div key={a.url} className="group relative flex items-center gap-2 pl-2 pr-7 py-1.5 rounded-lg bg-slate-100 text-xs text-slate-700 max-w-[14rem]">
                  {a.mimeType.startsWith('image/') && (
                    <img src={a.url} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                  )}
                  <span className="truncate">{a.nome}</span>
                  <button
                    onClick={() => setAnexos((prev) => prev.filter((x) => x.url !== a.url))}
                    className="absolute right-1.5 text-slate-400 hover:text-slate-700"
                    aria-label={`Remover ${a.nome}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {subindo > 0 && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-100 text-xs text-slate-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> enviando…
                </div>
              )}
            </div>
          )}

          <textarea
            ref={areaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files ?? []);
              if (files.length) { e.preventDefault(); void subirArquivos(files); }
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? 'Peça uma alteração na loja ou no ERP…'}
            className="w-full resize-none bg-transparent px-4 py-3.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
          />

          <div className="flex items-center gap-1 px-2.5 pb-2.5">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => { if (e.target.files) void subirArquivos(e.target.files); e.target.value = ''; }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              title="Anexar imagem"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            >
              <Paperclip className="w-[18px] h-[18px]" />
            </button>
            <span className="text-[11px] text-slate-400 ml-1 hidden sm:inline">
              Enter envia · Shift+Enter quebra linha
            </span>
            <div className="ml-auto">
              {streaming ? (
                <button
                  onClick={onParar}
                  title="Parar"
                  className="p-2 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  onClick={enviar}
                  disabled={disabled || subindo > 0 || (!texto.trim() && !anexos.length)}
                  title="Enviar"
                  className="p-2 rounded-lg bg-[#FF5B03] text-white hover:bg-[#e65003] disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Composer;
