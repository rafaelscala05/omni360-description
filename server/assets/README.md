# Assets de vídeo

## background-music.mp3

Trilha sonora de fundo usada na mixagem final dos vídeos de produto (30s).

⚠️ **Placeholder**: o arquivo atual é um pad ambiente sintético gerado via ffmpeg,
apenas para validar o pipeline. **Substitua** por uma trilha royalty-free real
(mesmo nome, `background-music.mp3`) antes de usar em produção.

A trilha é automaticamente:
- cortada/repetida (loop) para o tamanho do vídeo;
- abaixada de volume e mixada por baixo da narração (voz em off via TTS).

Não precisa ter 30s exatos — o pipeline ajusta a duração.
