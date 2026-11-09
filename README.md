# FotoGuia 3D

Aplicativo para celular (PWA, instalável em Android e iPhone) que:

1. **Detecta o objeto** a ser fotografado (IA no próprio aparelho: TensorFlow.js + COCO‑SSD).
2. **Delimita onde o objeto deve ficar** no quadro 3:4 (cantos verdes = enquadramento certo) e diz
   se é preciso aproximar, afastar ou mover a câmera.
3. **Indica o ângulo de cada foto** (posição ao redor do objeto, altura/inclinação e nível) pelos sensores
   do celular, com mapa de posições e setas de direção.
4. Salva tudo em **3:4** (JPEG) e exporta um **ZIP com as fotos + `poses.json`**, pronto para anúncio ou
   para **fotogrametria / modelagem 3D**.

## Sessões (planos de fotos)

| Sessão | Fotos | Uso |
|---|---|---|
| Rápido | 3 (frente, 3/4, lateral) | Anúncio simples |
| Anúncio | 7 (frente, 3/4 dir., lateral dir., traseira, lateral esq., 3/4 esq., superior) | Marketplace / loja |
| Scanner 3D | 24 (3 anéis × 8 posições: 10°, 35°, 60°) | Modelo 3D básico |
| Scanner 3D detalhado | 40 (3 anéis × 12 + 4 de cima) | Modelo 3D com mais detalhes |

Modos:
- **Andar ao redor do objeto**: o app mede pelo giroscópio quanto você andou ao redor do objeto.
- **Girar o objeto (prato giratório)**: a câmera fica parada; o app diz quanto girar o objeto e confere a
  inclinação da câmera.

## Como usar

1. Coloque o objeto sobre fundo liso e bem iluminado.
2. Fique **de frente** para o objeto e tire a primeira foto — ela define a referência 0° (“Frente”).
   (Ou use ⚙ → “Definir posição atual como Frente”.)
3. Siga a mensagem no topo do visor. Quando todos os indicadores ficarem verdes
   (Enquadramento, Ângulo, Altura, Nível), fotografe — ou ligue **Auto** para disparar sozinho.
4. O mapa redondo mostra o objeto no centro, as posições planejadas (amarelo = próxima, verde = feita)
   e onde você está (azul). Anel externo = câmera baixa; interno = câmera alta.
5. Na galeria: excluir/refazer fotos, **Compartilhar** (envia direto para WhatsApp/marketplace) ou
   **Baixar ZIP**.

Dica: toque num objeto destacado no visor para **travá‑lo** (útil quando há vários objetos).
Se a IA não reconhecer o produto (ela conhece 80 categorias comuns), desligue em ⚙
“Exigir objeto detectado” e use o quadro‑alvo como guia — o guia de ângulo continua funcionando.

## Modelagem 3D com as fotos

Importe a pasta do ZIP em **Meshroom** (gratuito), **RealityScan/RealityCapture**, **Agisoft Metashape**,
**COLMAP** ou **Polycam (upload de fotos)**. Dicas para um bom resultado:
- Não use zoom e mantenha a mesma distância (o quadro‑alvo ajuda nisso).
- Fundo com alguma textura ajuda o alinhamento no modo “andar ao redor”; no modo prato giratório,
  prefira fundo totalmente liso.
- Evite objetos brilhantes/transparentes (ou use spray fosco).

## Como rodar

A câmera e os sensores só funcionam em **HTTPS** (ou `localhost`). Opções:

- **Publicar grátis** (recomendado): envie a pasta para GitHub Pages, Netlify ou Cloudflare Pages
  e abra o link no celular. Depois, no navegador, “Adicionar à tela inicial” para instalar como app.
- **Testar no PC**: `npx serve .` e abra `http://localhost:3000` (no PC não há sensores de ângulo).
- **Testar no celular pela rede local**: use um túnel HTTPS, por exemplo `npx localtunnel --port 3000`
  ou `cloudflared tunnel --url http://localhost:3000`.

Todas as bibliotecas e o modelo de IA (~18 MB) estão dentro da pasta `vendor/`: o app **não acessa
nenhum servidor externo** e funciona offline desde a primeira abertura (depois de carregado uma vez).

## Segurança e privacidade

- Roda no navegador, isolado do sistema: não acessa arquivos, galeria, contatos nem outros apps.
- Permissões: câmera (só com o app aberto) e sensores de movimento. Não usa localização.
- As fotos ficam só na memória do aparelho e saem apenas quando você baixa ou compartilha.
  Não há servidor; a IA roda no próprio celular. As fotos não levam dados de GPS.
- Uma política de segurança (Content‑Security‑Policy em `index.html`) impede o app de carregar
  código ou enviar dados para qualquer outro site.
- Bibliotecas em `vendor/` (versões fixas, conferidas em dois servidores independentes):
  TensorFlow.js 4.22.0, COCO‑SSD 2.2.3 (modelo `ssdlite_mobilenet_v2`) e JSZip 3.10.1.
- Proteja com verificação em duas etapas a conta onde o app for publicado (GitHub/Netlify):
  quem controla a hospedagem controla o código.

## Estrutura

```
index.html            telas e layout
css/style.css         estilos (interface escura de câmera)
js/app.js             câmera, detecção, sensores, guia de ângulo, captura 3:4, exportação
js/pre-tf.js          ajuste para o TensorFlow.js funcionar sob a política de segurança
vendor/               bibliotecas e modelo de IA locais (sem dependência de servidores externos)
sw.js                 cache offline
manifest.webmanifest  instalação como app
icons/icon.svg        ícone
```

Para adicionar outras proporções no futuro, altere `ASPECT` em `js/app.js` e o `aspect-ratio`
de `.viewfinder` em `css/style.css`.
