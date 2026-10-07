// <img> que chega saindo do desfoque. Enquanto carrega, o lugar dela é um
// esqueleto com brilho, para a grade não "pular" quando a imagem aparece.

import React, { useState } from 'react';

type Props = React.ImgHTMLAttributes<HTMLImageElement> & { wrapperClassName?: string };

const ImagemRevelada: React.FC<Props> = ({ wrapperClassName = '', className = '', onLoad, onError, ...img }) => {
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  return (
    <span className={`relative block overflow-hidden ${wrapperClassName}`}>
      {estado === 'carregando' && <span aria-hidden className="ag-shimmer absolute inset-0" />}
      <img
        {...img}
        className={`${className} ${estado === 'ok' ? 'ag-revela' : ''}`}
        style={{ ...img.style, opacity: estado === 'carregando' ? 0 : undefined }}
        onLoad={(e) => {
          setEstado('ok');
          onLoad?.(e);
        }}
        onError={(e) => {
          setEstado('erro');
          onError?.(e);
        }}
      />
    </span>
  );
};

export default ImagemRevelada;
