<div align="center">

# glance

**Veja o que o Claude constrói — dentro do próprio Claude Code.**

Imagens, prints e páginas HTML renderizadas, desenhadas no chat, nítidas.

[![MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-7c3aed)](LICENSE)
[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-f97316)](#instalação)
[![Ghostty · kitty · WezTerm](https://img.shields.io/badge/terminais-Ghostty%20%C2%B7%20kitty%20%C2%B7%20WezTerm-0ea5e9)](#terminais)
[![Stars](https://img.shields.io/github/stars/Rocha101/claude-code-glance?style=social)](https://github.com/Rocha101/claude-code-glance/stargazers)

[English](README.md) · **Português**

<img src="assets/hero.png" alt="O Claude escreve menu.html e a página renderizada aparece no chat, logo abaixo da linha do Write" width="100%">

</div>

## Por quê

O Claude escreve uma landing page, um dashboard, um gráfico, um template de e-mail… e você dá `alt-tab` pro navegador pra ver se ficou bom. Toda. Santa. Vez.

O **glance** fecha esse ciclo. Assim que o Claude escreve ou edita um `.html`, um Chromium headless renderiza e a página de verdade aparece **no chat, embaixo da chamada da ferramenta**. O mesmo vale pra toda imagem que o Claude lê. Sem navegador, sem trocar de janela.

## Recursos

- **Preview de HTML ao vivo** — todo `Write` / `Edit` de `.html` desenha a página no chat.
- **Imagens no chat** — toda imagem que o Claude dá `Read` (png, jpg, gif, webp, bmp, svg) aparece embaixo da linha.
- **`/glance` em qualquer coisa** — `/glance mockup.png pagina.html grafico.svg` mostra qualquer arquivo na hora.
- **Galeria inteligente** — várias imagens lado a lado em linhas justificadas, mesma altura, com legenda.
- **Tamanho certo** — tamanho real, nunca ampliado; metade da largura em tela cheia, largura toda com a tela dividida.
- **Recorte justo** — o espaço vazio embaixo de páginas curtas é cortado.
- **Funciona em todo terminal** — pixels de verdade em terminais com protocolo kitty, arte em blocos coloridos nos outros.

<img src="assets/gallery.png" alt="/glance com três imagens lado a lado com legenda" width="100%">

## Instalação

```bash
curl -fsSL https://raw.githubusercontent.com/Rocha101/claude-code-glance/main/install.sh | bash
```

Depois abra uma sessão **nova** do Claude Code. Só isso.

<details>
<summary>Instalação manual</summary>

```bash
git clone https://github.com/Rocha101/claude-code-glance ~/.claude/mods/claude-code-glance
```

Adicione a pasta em `CLAUDE_CODE_PLUGIN_DIRS` no bloco `env` do `~/.claude/settings.json` (separado por `:`), ou abra o Claude Code com `claude --plugin-dir ~/.claude/mods/claude-code-glance`.

</details>

**Requisitos:** Claude Code 2.1.287+ (mods), `chromium` ou `google-chrome`, ImageMagick (`magick`), `jq`, `git`.

## Uso

| Você faz | O glance mostra |
|---|---|
| Pede pro Claude criar qualquer página HTML | a página renderizada embaixo da linha do `Write` |
| O Claude edita a página | a nova versão embaixo da linha do `Edit` |
| O Claude lê um print ou imagem | a imagem embaixo da linha do `Read` |
| `/glance a.png b.html c.jpg` | todas, lado a lado |

**Dica — faça o Claude te *mostrar* as coisas.** Coloque isto no `~/.claude/CLAUDE.md`:

```md
Pra me mostrar imagem, print, gráfico ou página, dê `Read` no arquivo de imagem (o glance desenha no chat).
Pra uma URL ou página que você não mudou: `chromium --headless --screenshot=<png> --window-size=1280,900 <url>` e `Read` no png.
```

## Terminais

| Terminal | Resultado |
|---|---|
| **Ghostty**, **kitty**, **WezTerm** | pixels de verdade, nítido (protocolo gráfico do kitty) |
| Outros (foot, Alacritty, GNOME Terminal…) | arte em blocos coloridos (2×2 pixels por célula) |
| **herdr** | pixels de verdade com `[experimental] kitty_graphics = true` no `~/.config/herdr/config.toml` e o server reiniciado; o instalador liga `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` |
| tmux | arte em blocos (o tmux não repassa gráficos) |

## Configuração

No bloco `env` do `~/.claude/settings.json`:

| Variável | Padrão | O que faz |
|---|---|---|
| `GLANCE_MODE` | auto | `image` força pixels de verdade, `cells` força arte em blocos |
| `GLANCE_CELL_PX` | `12` | pixels da imagem por coluna do terminal — maior = imagem menor |
| `GLANCE_CELL_RATIO` | `2.25` | altura ÷ largura da célula da sua fonte, mantém a imagem sem distorção |
| `CLAUDE_CODE_FORCE_TERMINAL_IMAGES` | — | `1` faz o Claude Code mandar imagem onde ele não detecta suporte (multiplexadores) |

## Como funciona

Um **mod** do Claude Code (um módulo de hooks, `hooks/register.tsx`):

1. `tool.call` — depois de um `Write`/`Edit` de HTML ou de um `Read` de imagem, renderiza: HTML num Chromium headless em 1280×900, recortado no conteúdo; imagens normalizadas com o ImageMagick.
2. `ui.render` em `ToolResult`, `ToolGroup` e `CommandOutput` — desenha a imagem embaixo da linha, como `Image` (protocolo kitty) ou `Raster` de blocos.
3. Um layout justificado distribui várias imagens em linhas que cabem no chat.

## Limites

- A página é capturada em 1280×900 — o que fica abaixo da primeira tela não aparece.
- O `/glance` separa os caminhos por espaço.
- As renderizações ficam em `/dev/shm` e somem no reboot.

## Contribuindo

```bash
claude plugin validate .   # o que o engine vai carregar
claude plugin test .       # os testes
```

Issues e PRs são bem-vindos. Se o glance te poupou um `alt-tab`, **[deixa uma estrela](https://github.com/Rocha101/claude-code-glance)** ⭐ — ajuda outras pessoas a encontrarem.

Veja também: **[quickswitch](https://github.com/Rocha101/claude-code-quickswitch)** — troque de conta do Claude com um clique na status line.

## Licença

[MIT](LICENSE) © Rocha101
