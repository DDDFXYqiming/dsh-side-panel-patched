import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { basicSetup, EditorView } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { css as cssLanguage } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { Compartment, type Extension } from '@codemirror/state'
import { defaultHighlightStyle, syntaxHighlighting, type Language } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { tagHighlighter, highlightTree, tags } from '@lezer/highlight'
import { Terminal as XTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import { FILE_BROWSER_ROUTE, type ApiResponse, type BrowserEntry, type Preview, type ReviewMode } from '../protocol.ts'

interface ClientContext {
  workspaces: {
    openPath(path: string): Promise<void>
  }
  effect(callback: () => (() => void), label?: string): void
}

export const inject = ['sessions', 'workspaces']

const fishRoots = new Map<HTMLElement, Root>()

function createFishLogo(): HTMLElement {
  const host = document.createElement('span')
  const root = createRoot(host)
  flushSync(() => root.render(createElement(FishLogo, { size: 23 })))
  fishRoots.set(host, root)
  return host
}

function removeFishLogo(host: HTMLElement): void {
  fishRoots.get(host)?.unmount()
  fishRoots.delete(host)
  host.remove()
}

// PATCH(2026-08-21) markdown preview: GitHub-style typography + lezer "tok-*" syntax colours.
// Theme adaptive: light by default, dark overrides keyed off body[data-ds-dark-theme].
const markdownCss = `
#dsh-file-browser .dfb-markdown{font:14px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,'PingFang SC','Microsoft YaHei',sans-serif;word-wrap:break-word;overflow-wrap:break-word;padding:16px 20px 24px}
#dsh-file-browser .dfb-markdown>*:first-child{margin-top:0!important}
#dsh-file-browser .dfb-markdown>*:last-child{margin-bottom:0!important}
#dsh-file-browser .dfb-markdown h1,#dsh-file-browser .dfb-markdown h2,#dsh-file-browser .dfb-markdown h3,#dsh-file-browser .dfb-markdown h4,#dsh-file-browser .dfb-markdown h5,#dsh-file-browser .dfb-markdown h6{margin:24px 0 16px;font-weight:600;line-height:1.25}
#dsh-file-browser .dfb-markdown h1{font-size:2em;padding-bottom:.3em;border-bottom:1px solid var(--dfb-border)}
#dsh-file-browser .dfb-markdown h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid var(--dfb-border)}
#dsh-file-browser .dfb-markdown h3{font-size:1.25em}
#dsh-file-browser .dfb-markdown h4{font-size:1em}
#dsh-file-browser .dfb-markdown h5{font-size:.875em}
#dsh-file-browser .dfb-markdown h6{font-size:.85em;color:var(--dfb-text-3)}
#dsh-file-browser .dfb-markdown p,#dsh-file-browser .dfb-markdown blockquote,#dsh-file-browser .dfb-markdown ol,#dsh-file-browser .dfb-markdown ul,#dsh-file-browser .dfb-markdown dl,#dsh-file-browser .dfb-markdown table,#dsh-file-browser .dfb-markdown pre,#dsh-file-browser .dfb-markdown details{margin:0 0 16px}
#dsh-file-browser .dfb-markdown ol,#dsh-file-browser .dfb-markdown ul{padding-left:2em}
#dsh-file-browser .dfb-markdown li+li{margin-top:.25em}
#dsh-file-browser .dfb-markdown li>p{margin-bottom:.5em}
#dsh-file-browser .dfb-markdown a{color:var(--dfb-brand);text-decoration:none}
#dsh-file-browser .dfb-markdown a:hover{text-decoration:underline}
#dsh-file-browser .dfb-markdown hr{height:.25em;padding:0;margin:24px 0;background:var(--dfb-border);border:0}
#dsh-file-browser .dfb-markdown blockquote{padding:0 1em;color:var(--dfb-text-3);border-left:.25em solid var(--dfb-border)}
#dsh-file-browser .dfb-markdown code{font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace}
#dsh-file-browser .dfb-markdown :not(pre)>code{padding:.2em .4em;font-size:85%;background:var(--dfb-l2);border-radius:6px;white-space:break-spaces}
#dsh-file-browser .dfb-markdown pre{position:relative;margin:16px 0;padding:14px 16px;overflow:auto;background:var(--dfb-l1);border:1px solid var(--dfb-border-soft);border-radius:8px;line-height:1.55;tab-size:2}
#dsh-file-browser .dfb-markdown pre code{display:block;padding:0;background:transparent;font-size:12.5px;white-space:pre}
#dsh-file-browser .dfb-markdown pre[data-df-lang]::before{content:attr(data-df-lang);position:absolute;top:8px;right:12px;font:600 11px/1 ui-monospace,monospace;color:var(--dfb-text-3);text-transform:lowercase;user-select:none;pointer-events:none}
#dsh-file-browser .dfb-markdown table{display:block;width:max-content;max-width:100%;overflow:auto;border-spacing:0;border-collapse:collapse}
#dsh-file-browser .dfb-markdown table th,#dsh-file-browser .dfb-markdown table td{padding:6px 13px;border:1px solid var(--dfb-border)}
#dsh-file-browser .dfb-markdown table tr{background:var(--dfb-bg);border-top:1px solid var(--dfb-border)}
#dsh-file-browser .dfb-markdown table tr:nth-child(2n){background:var(--dfb-l2)}
#dsh-file-browser .dfb-markdown img{max-width:100%}
#dsh-file-browser .dfb-markdown input[type="checkbox"]{margin:0 .4em 0 0;vertical-align:middle}
#dsh-file-browser .dfb-markdown del{color:var(--dfb-text-3)}
#dsh-file-browser .dfb-markdown kbd{display:inline-block;padding:3px 5px;font:11px/1.4 ui-monospace,monospace;background:var(--dfb-l2);border:1px solid var(--dfb-border);border-radius:6px;box-shadow:inset 0 -1px 0 var(--dfb-border)}
/* lezer "tok-*" syntax colours (GitHub light) */
#dsh-file-browser .dfb-markdown .tok-keyword{color:#cf222e}
#dsh-file-browser .dfb-markdown .tok-string{color:#0a3069}
#dsh-file-browser .dfb-markdown .tok-number,#dsh-file-browser .dfb-markdown .tok-atom,#dsh-file-browser .dfb-markdown .tok-bool{color:#0550ae}
#dsh-file-browser .dfb-markdown .tok-comment{color:#6e7781;font-style:italic}
#dsh-file-browser .dfb-markdown .tok-regexp,#dsh-file-browser .dfb-markdown .tok-url,#dsh-file-browser .dfb-markdown .tok-link,#dsh-file-browser .dfb-markdown .tok-meta{color:#8250df}
#dsh-file-browser .dfb-markdown .tok-operator,#dsh-file-browser .dfb-markdown .tok-propertyName{color:#0550ae}
#dsh-file-browser .dfb-markdown .tok-variableName,#dsh-file-browser .dfb-markdown .tok-typeName,#dsh-file-browser .dfb-markdown .tok-namespace,#dsh-file-browser .dfb-markdown .tok-macroName,#dsh-file-browser .dfb-markdown .tok-definition,#dsh-file-browser .dfb-markdown .tok-local{color:#953800}
#dsh-file-browser .dfb-markdown .tok-className,#dsh-file-browser .dfb-markdown .tok-functionName,#dsh-file-browser .dfb-markdown .tok-variableName2{color:#8250df}
#dsh-file-browser .dfb-markdown .tok-literal,#dsh-file-browser .dfb-markdown .tok-string2{color:#0a3069}
#dsh-file-browser .dfb-markdown .tok-tagName{color:#116329}
#dsh-file-browser .dfb-markdown .tok-attributeName,#dsh-file-browser .dfb-markdown .tok-labelName{color:#953800}
#dsh-file-browser .dfb-markdown .tok-invalid{color:#82071e;text-decoration:underline wavy currentColor}
#dsh-file-browser .dfb-markdown .tok-heading{color:#0a3069}
#dsh-file-browser .dfb-markdown .tok-emphasis{font-style:italic}
#dsh-file-browser .dfb-markdown .tok-strong{font-weight:600}
#dsh-file-browser .dfb-markdown .tok-inserted{color:#116329}
#dsh-file-browser .dfb-markdown .tok-deleted{color:#cf222e}
/* lezer "tok-*" syntax colours (GitHub dark) */
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-keyword{color:#ff7b72}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-string{color:#a5d6ff}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-number,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-atom,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-bool{color:#79c0ff}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-comment{color:#8b949e;font-style:italic}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-regexp,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-url,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-link,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-meta{color:#a5d6ff}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-operator,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-propertyName{color:#79c0ff}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-variableName,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-typeName,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-namespace,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-macroName,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-definition,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-local{color:#ffa657}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-className,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-functionName,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-variableName2{color:#d2a8ff}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-literal,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-string2{color:#a5d6ff}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-tagName{color:#7ee787}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-attributeName,body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-labelName{color:#ffa657}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-invalid{color:#ffa198;text-decoration:underline wavy currentColor}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-heading{color:#a5d6ff}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-emphasis{font-style:italic}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-strong{font-weight:600}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-inserted{color:#aff5b4}
body[data-ds-dark-theme] #dsh-file-browser .dfb-markdown .tok-deleted{color:#ffa198}
/* mermaid diagram containers */
#dsh-file-browser .dfb-mermaid{margin:16px 0;display:flex;align-items:center;justify-content:center;min-height:64px;padding:14px 16px;background:var(--dfb-bg);border:1px solid var(--dfb-border-soft);border-radius:8px;overflow:auto}
#dsh-file-browser .dfb-mermaid svg{max-width:100%;height:auto}
#dsh-file-browser .dfb-mermaid-loading{color:var(--dfb-text-3);font:12px/1.6 ui-monospace,monospace;opacity:.8}
#dsh-file-browser .dfb-mermaid-note{margin-bottom:8px;color:var(--dfb-text-3);font:12px/1.6 ui-monospace,monospace}
#dsh-file-browser .dfb-mermaid-fallback{margin:0;white-space:pre;font:12px/1.6 ui-monospace,monospace;color:var(--dfb-text-2)}
`

const css = `
#dsh-file-browser{position:relative;z-index:1;grid-column:2;grid-row:2;min-width:0;width:100%;height:100%;overflow:hidden;display:grid;grid-template-rows:52px minmax(0,1fr);background:#1b1b1c;color:var(--dsw-alias-content-primary,#eee);border-left:1px solid var(--dsw-alias-stroke-default,#3a3a3a)}
#dsh-file-browser[hidden]{display:none}.dfb-head{display:flex;align-items:center;gap:4px;padding:0 10px;border-bottom:1px solid #ffffff18}.dfb-panel-tabs{display:flex;min-width:0;flex:1;gap:4px;overflow:auto}.dfb-panel-tab{border:0;background:transparent;color:#aaa;padding:9px 12px;border-radius:8px;cursor:pointer;white-space:nowrap}.dfb-panel-tab:hover{background:#ffffff0b}.dfb-panel-tab[data-active="true"]{background:#2a2a2b;color:#fff}.dfb-tools{display:flex;gap:3px}.dfb-tool,.dfb-close{width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:inherit;font-size:18px;cursor:pointer}.dfb-tool:hover,.dfb-close:hover{background:#ffffff12}
.dfb-tab{margin-left:auto!important;overflow:visible}.dfb-tab-stage{position:relative;display:inline-grid;min-width:2em;place-items:center}.dfb-tab-label{display:inline-block;will-change:transform,opacity}.dfb-tab-label[data-motion="out"]{animation:dfb-tab-label-out 180ms ease-in forwards}.dfb-tab-label[data-motion="in"]{animation:dfb-tab-label-in 260ms ease-out forwards}.dfb-tab-whale{position:absolute;z-index:3;left:50%;bottom:-5px;width:23px;height:auto;color:#4c8dff;opacity:0;pointer-events:none;filter:drop-shadow(0 3px 4px #276ce766);transform-origin:50% 70%}.dfb-tab-splash{position:absolute;z-index:2;left:50%;bottom:-4px;width:38px;height:12px;opacity:0;pointer-events:none;transform:translateX(-50%)}.dfb-tab-splash::before,.dfb-tab-splash::after{content:"";position:absolute;left:50%;bottom:1px;border:1.5px solid #4c8dff;border-bottom:0;border-radius:50% 50% 0 0;transform:translateX(-50%)}.dfb-tab-splash::before{width:12px;height:5px}.dfb-tab-splash::after{width:25px;height:8px;opacity:.65}.dfb-tab-stage[data-celebrate="true"] .dfb-tab-whale{animation:dfb-whale-jump 920ms cubic-bezier(.2,.72,.25,1) both}.dfb-tab-stage[data-celebrate="true"] .dfb-tab-splash{animation:dfb-water-splash 620ms ease-out both}.dfb-tab-stage[data-celebrate="true"] .dfb-tab-splash>i,.dfb-tab-stage[data-celebrate="true"] .dfb-tab-splash>b{position:absolute;bottom:2px;width:3px;height:3px;border-radius:50%;background:#6ba2ff;content:""}.dfb-tab-stage[data-celebrate="true"] .dfb-tab-splash>i{left:7px;animation:dfb-droplet-left 520ms ease-out both}.dfb-tab-stage[data-celebrate="true"] .dfb-tab-splash>b{right:7px;animation:dfb-droplet-right 570ms ease-out both}@keyframes dfb-tab-label-out{to{transform:translateY(-45%);opacity:0}}@keyframes dfb-tab-label-in{from{transform:translateY(45%);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes dfb-whale-jump{0%{opacity:0;transform:translate(-12px,12px) rotate(-24deg) scale(.7)}8%{opacity:1}10%{transform:translate(-10px,-6px) rotate(-54deg) scale(.82)}25%{transform:translate(-7px,-28px) rotate(-99deg) scale(1)}40%{transform:translate(-4px,-38px) rotate(-144deg) scale(1.09)}50%{opacity:1;transform:translate(-2px,-40px) rotate(-174deg) scale(1.1)}60%{transform:translate(1px,-38px) rotate(-204deg) scale(1.08)}75%{transform:translate(5px,-28px) rotate(-249deg) scale(1)}90%{opacity:1;transform:translate(9px,-6px) rotate(-294deg) scale(.84)}100%{opacity:0;transform:translate(12px,12px) rotate(-324deg) scale(.7)}}@keyframes dfb-water-splash{0%,5%{opacity:0;transform:translateX(-50%) scale(.3)}14%{opacity:1;transform:translateX(-50%) scale(.8)}32%{opacity:0;transform:translateX(-50%) scaleX(1.35) scaleY(.65)}76%{opacity:0;transform:translate(7px) scale(.25)}88%{opacity:1;transform:translate(7px) scale(1.1)}100%{opacity:0;transform:translate(7px) scaleX(1.65) scaleY(.65)}}@keyframes dfb-droplet-left{0%,6%{opacity:0;transform:translate(8px,4px)}16%{opacity:1}31%{opacity:0;transform:translate(-7px,-12px)}78%{opacity:0;transform:translate(14px,3px)}88%{opacity:1}100%{opacity:0;transform:translate(5px,-16px)}}@keyframes dfb-droplet-right{0%,6%{opacity:0;transform:translate(-8px,4px)}16%{opacity:1}33%{opacity:0;transform:translate(8px,-15px)}78%{opacity:0;transform:translate(9px,3px)}88%{opacity:1}100%{opacity:0;transform:translate(20px,-13px)}}@media(prefers-reduced-motion:reduce){.dfb-tab-label[data-motion="out"],.dfb-tab-label[data-motion="in"]{animation-duration:1ms}.dfb-tab-whale,.dfb-tab-splash{display:none}}.dfb-tab[aria-selected="true"]{color:var(--dsw-alias-state-business-primary,#3978ff)!important}.dfb-tab::after{content:"";position:absolute;right:0;bottom:0;left:0;height:3px;background:transparent}.dfb-tab[aria-selected="true"]::after{background:var(--dsw-alias-state-business-primary,#3978ff)}
.dfb-whale-flight{position:fixed;z-index:10020;width:80px;height:64px;overflow:visible;pointer-events:none}.dfb-whale-flight .dfb-tab-whale{display:block;animation:dfb-whale-jump 1080ms linear both}.dfb-whale-flight .dfb-tab-splash{display:block;animation:dfb-water-splash 1080ms linear both}.dfb-whale-flight .dfb-tab-splash>i,.dfb-whale-flight .dfb-tab-splash>b{position:absolute;bottom:2px;width:3px;height:3px;border-radius:50%;background:#6ba2ff}.dfb-whale-flight .dfb-tab-splash>i{left:7px;animation:dfb-droplet-left 1080ms linear both}.dfb-whale-flight .dfb-tab-splash>b{right:7px;animation:dfb-droplet-right 1080ms linear both}
.dfb-menu{position:fixed;z-index:10000;min-width:220px;padding:6px;border:1px solid #ffffff1c;border-radius:10px;background:#303030;color:#eee;box-shadow:0 12px 32px #0008}.dfb-menu[hidden]{display:none}.dfb-menu button{display:flex;width:100%;gap:10px;padding:9px 11px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left}.dfb-menu button:hover{background:#ffffff12}.dfb-menu-sep{height:1px;margin:5px;background:#ffffff16}.dfb-submenu{position:absolute;right:100%;top:42px}.dfb-disclosure{display:inline-grid;width:12px;flex:none;place-items:center;color:#d8a629;font-size:10px}.dfb-file-icon{display:inline-grid;width:17px;height:17px;flex:none;place-items:center}.dfb-file-icon svg{display:block;width:16px;height:16px}.dfb-file-badge{font:700 9px/16px ui-monospace,monospace;text-align:center;border-radius:3px}.dfb-icon-js{background:#e5c84b;color:#202020}.dfb-icon-ts{background:#3178c6;color:white}.dfb-icon-json{color:#d5b64b;font:700 13px/16px ui-monospace,monospace}.dfb-icon-md{color:#71a7e8;font:700 12px/16px ui-monospace,monospace}.dfb-icon-yaml{color:#db6161;font:700 11px/16px ui-monospace,monospace}.dfb-icon-shell{background:#529b55;color:white}.dfb-icon-config{color:#aeb4bd;font-size:15px}.dfb-icon-generic{color:#aeb4bd}
.dfb-resizer{position:absolute;z-index:2;inset:0 auto 0 -6px;width:12px;cursor:col-resize;touch-action:none}.dfb-resizer::after{content:"";position:absolute;inset:0 auto 0 5px;width:1px;background:transparent}.dfb-resizer:hover::after,.dfb-resizer[data-dragging="true"]::after{background:var(--dsw-alias-state-business-primary,#6b8cff)}
.dfb-content{min-height:0;overflow:hidden}.dfb-view{height:100%;min-height:0}.dfb-view[hidden]{display:none}.dfb-files{display:grid;grid-template-rows:44px minmax(0,1fr);min-height:0;overflow:hidden}.dfb-files[hidden]{display:none}.dfb-file-toolbar{display:flex;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid #ffffff18}.dfb-path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dfb-body{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 220px;height:100%;overflow:hidden}.dfb-body[data-tree="false"]{grid-template-columns:minmax(0,1fr) 0}.dfb-body[data-tree="false"] .dfb-tree-pane{display:none}.dfb-tree-pane{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;border-left:1px solid #ffffff18}.dfb-filter{flex:none;margin:10px;padding:9px 11px;border:1px solid #ffffff1f;border-radius:8px;background:#232324;color:inherit;outline:none}.dfb-tree{flex:1;min-height:0;overflow:auto;padding:2px 8px 8px}.dfb-preview{position:relative;min-width:0;min-height:0;overflow:auto;padding:0}.dfb-preview-message{position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center}.dfb-preview-card{max-width:420px;color:#aaa}.dfb-preview-icon{margin-bottom:12px;color:#d6a936;font-size:30px}.dfb-preview-title{margin-bottom:7px;color:#eee;font-size:16px;font-weight:600}.dfb-preview-detail{line-height:1.6;color:#999}.dfb-row{display:flex;align-items:center;width:100%;gap:6px;border:0;background:transparent;color:inherit;padding:5px 7px;border-radius:6px;text-align:left;cursor:pointer}.dfb-row:hover{background:#ffffff10}.dfb-row span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dfb-children{padding-left:14px}.dfb-code{margin:0;white-space:pre;tab-size:2;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}.dfb-editor{height:100%}.dfb-editor .cm-editor{height:100%;background:#1b1b1c;color:#f1f1f1;font:14px/1.72 ui-monospace,SFMono-Regular,Consolas,monospace}.dfb-editor .cm-scroller{overflow:auto}.dfb-editor .cm-content{caret-color:#fff}.dfb-editor .cm-gutters{background:#1b1b1c;color:#9a9a9a;border:0}.dfb-editor .cm-activeLine,.dfb-editor .cm-activeLineGutter{background:#ffffff0b}.dfb-editor .cm-selectionBackground{background:#315f9f!important}.dfb-image{display:block;max-width:100%;max-height:calc(100vh - 100px);margin:auto}.dfb-empty{color:var(--dsw-alias-content-secondary,#aaa);display:grid;place-items:center;height:100%;text-align:center}.dfb-markdown{box-sizing:border-box;line-height:1.65;padding:18px;color:#ededed}.dfb-markdown pre{overflow:auto;padding:12px;background:#0003;border-radius:8px}.dfb-markdown img{max-width:100%}.dfb-console{box-sizing:border-box;width:100%;height:100%;padding:0;background:#151515;overflow:hidden}.dfb-console .xterm{box-sizing:border-box;width:100%;height:100%;padding:12px;position:relative;overflow:hidden;cursor:text;user-select:none}.dfb-console .xterm:focus,.dfb-console .xterm.focus{outline:none}.dfb-console .xterm-helpers{position:absolute;top:0;z-index:5}.dfb-console .xterm-helper-textarea{position:absolute;left:-9999em;top:0;width:0;height:0;margin:0;padding:0;border:0;opacity:0;overflow:hidden;resize:none;white-space:nowrap;z-index:-5}.dfb-console .composition-view{display:none;position:absolute;background:#000;color:#fff;white-space:nowrap;z-index:1}.dfb-console .composition-view.active{display:block}.dfb-console .xterm-viewport{position:absolute;inset:12px;overflow-y:scroll;overflow-x:hidden;cursor:default;background:#151515}.dfb-console .xterm-screen{position:relative;max-width:100%;overflow:hidden}.dfb-console .xterm-screen canvas{position:absolute;left:0;top:0}.dfb-console .xterm-char-measure-element{display:inline-block;visibility:hidden;position:absolute;left:-9999em;top:0;line-height:normal}.dfb-console .xterm-accessibility:not(.debug),.dfb-console .xterm-message{position:absolute;inset:0;z-index:10;color:transparent;pointer-events:none}.dfb-console .live-region{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.dfb-review{box-sizing:border-box;margin:0;height:100%;overflow:auto;white-space:pre-wrap;padding:16px;color:#ededed;font:13px/1.65 ui-monospace,monospace}.dfb-side-list{box-sizing:border-box;padding:12px}.dfb-side-row{display:block;width:100%;padding:10px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left}.dfb-side-row:hover{background:#ffffff10}@media(max-width:760px){.dfb-body{grid-template-columns:minmax(0,1fr) 170px}}`

const reviewCss = `
.dfb-review{box-sizing:border-box;height:100%;overflow:auto;padding:14px;background:#171718;color:#ddd;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.dfb-review-summary{margin-bottom:14px;border:1px solid #ffffff16;border-radius:8px;overflow:hidden;background:#1d1d1e}.dfb-review-summary-title,.dfb-diff-title{display:flex;width:100%;align-items:center;gap:8px;box-sizing:border-box;padding:9px 12px;border:0;background:#242425;color:#f2f2f2;font:inherit;font-weight:600;text-align:left}.dfb-review-summary-title{cursor:pointer}.dfb-review-summary-title:hover,.dfb-diff-title:hover{background:#2a2a2b}.dfb-review-disclosure{width:12px;color:#aaa}.dfb-status-row{display:flex;width:100%;box-sizing:border-box;align-items:center;gap:9px;padding:6px 12px;border:0;border-top:1px solid #ffffff0d;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.dfb-status-row:hover{background:#ffffff0a}.dfb-status-code{display:inline-grid;width:22px;height:20px;flex:none;place-items:center;border-radius:4px;background:#876b2533;color:#e5bd55;font-weight:700}.dfb-status-code[data-kind="new"]{background:#2d754733;color:#63d38d}.dfb-status-code[data-kind="deleted"]{background:#9a3d3d33;color:#f07878}.dfb-status-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dfb-diff-file{margin-bottom:10px;border:1px solid #ffffff16;border-radius:7px;overflow:auto;background:#1b1b1c;scroll-margin-top:58px}.dfb-diff-file[data-selected="true"]{border-color:#4f80d8;box-shadow:0 0 0 1px #4f80d844}.dfb-diff-title{position:sticky;left:0}.dfb-diff-toggle{display:flex;min-width:0;flex:1;align-items:center;gap:8px;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-weight:600;text-align:left;cursor:pointer}.dfb-diff-toggle span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dfb-file-add{margin-left:auto;color:#63d38d}.dfb-file-del{color:#f07878}.dfb-git-action{width:26px;height:26px;border:1px solid #ffffff16;border-radius:50%;background:transparent;color:#aaa;font-size:17px;cursor:pointer}.dfb-git-action:hover{background:#ffffff12;color:#fff}.dfb-diff-body[hidden],.dfb-review-summary-body[hidden]{display:none}.dfb-diff-row{display:grid;grid-template-columns:34px 34px minmax(max-content,1fr);width:max-content;min-width:100%}.dfb-diff-row>span{min-height:21px}.dfb-diff-num{box-sizing:border-box;padding:1px 5px;border-right:1px solid #ffffff10;background:#151516;color:#74747c;text-align:right;user-select:none}.dfb-diff-code{padding:1px 9px;white-space:pre}.dfb-diff-gutter-head{position:sticky;top:0;z-index:1;border-bottom:1px solid #ffffff12;background:#202021;color:#8d8d95}.dfb-diff-gutter-head .dfb-diff-num{background:#202021;color:#999;text-align:center;font-weight:600}.dfb-diff-gutter-head .dfb-diff-code{background:#202021;color:#777}.dfb-diff-add{background:#234b2c66}.dfb-diff-add .dfb-diff-code{color:#b7e7c1}.dfb-diff-del{background:#572b2b66}.dfb-diff-del .dfb-diff-code{color:#f0b4b4}.dfb-diff-hunk{background:#263957}.dfb-diff-hunk .dfb-diff-code{color:#a9c9f4}.dfb-diff-meta .dfb-diff-code{color:#85858d}.dfb-review-empty{display:grid;height:calc(100% - 50px);place-items:center;padding:32px;color:#999;text-align:center;white-space:normal}.dfb-review-toolbar{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:10px;margin:-14px -14px 14px;padding:10px 14px;border-bottom:1px solid #ffffff14;background:#1b1b1cf2;backdrop-filter:blur(8px)}.dfb-review-mode-wrap{position:relative}.dfb-review-mode{display:flex;min-width:150px;align-items:center;justify-content:space-between;gap:14px;padding:7px 10px;border:1px solid #ffffff12;border-radius:7px;background:#282829;color:#eee;font:inherit;font-weight:600;cursor:pointer}.dfb-review-mode:hover,.dfb-review-mode[aria-expanded="true"]{border-color:#ffffff25;background:#303031}.dfb-review-mode-arrow{color:#aaa;font-size:10px}.dfb-review-mode-menu{position:absolute;z-index:8;top:calc(100% + 5px);left:0;min-width:190px;padding:5px;border:1px solid #ffffff1c;border-radius:9px;background:#2b2b2c;box-shadow:0 10px 26px #0008}.dfb-review-mode-menu[hidden]{display:none}.dfb-review-mode-item{display:flex;width:100%;align-items:center;justify-content:space-between;padding:8px 10px;border:0;border-radius:6px;background:transparent;color:#ddd;font:inherit;text-align:left;cursor:pointer}.dfb-review-mode-item:hover{background:#ffffff10;color:#fff}.dfb-review-mode-item[data-selected="true"]{background:#3b3b3d;color:#fff}.dfb-review-mode-check{width:14px;color:#6d9cff}.dfb-review-count{color:#888}.dfb-review-add{margin-left:auto;color:#63d38d}.dfb-review-del{color:#f07878}.dfb-review-branch{color:#ddd}.dfb-git-list{border:1px solid #ffffff16;border-radius:8px;overflow:hidden;background:#1d1d1e}.dfb-git-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid #ffffff0d}.dfb-git-row:last-child{border-bottom:0}.dfb-git-primary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f2f2f2}.dfb-git-secondary{color:#8f8f96}.dfb-git-ref{color:#d3ad55}.dfb-tree[hidden]{display:none}.dfb-search-results{padding-top:4px;color:#999}.dfb-search-note{padding:10px;color:#888;font-size:12px;line-height:1.5}`

const themeCss = `
#dsh-file-browser{--dfb-bg:var(--dsw-alias-bg-base,#fff);--dfb-l1:var(--dsw-alias-bg-layer-1,#fff);--dfb-l2:var(--dsw-alias-bg-layer-2,#f7f7f8);--dfb-l3:var(--dsw-alias-bg-layer-3,#eee);--dfb-hover:var(--dsw-alias-interactive-bg-hover,#0000000f);--dfb-active:var(--dsw-alias-interactive-bg-active,#00000019);--dfb-border:var(--dsw-alias-border-l2,#0000001a);--dfb-border-soft:var(--dsw-alias-border-l1,#0000000a);--dfb-text:var(--dsw-alias-label-primary,#171719);--dfb-text-2:var(--dsw-alias-label-secondary,#555);--dfb-text-3:var(--dsw-alias-label-tertiary,#777);--dfb-brand:var(--dsw-alias-state-business-primary,#3978ff);--dfb-success:var(--dsw-alias-state-success-primary,#168f55);--dfb-success-bg:var(--dsw-alias-state-success-tertiary,#e7f7ee);--dfb-danger:var(--dsw-alias-state-error-primary,#d73535);--dfb-warn:var(--dsw-alias-state-warn-label,#a76500);background:var(--dfb-bg);color:var(--dfb-text);border-color:var(--dfb-border)}
#dsh-file-browser .dfb-head,#dsh-file-browser .dfb-file-toolbar,#dsh-file-browser .dfb-tree-pane{border-color:var(--dfb-border)}
#dsh-file-browser .dfb-panel-tab{color:var(--dfb-text-2)}#dsh-file-browser .dfb-panel-tab:hover,#dsh-file-browser .dfb-tool:hover,#dsh-file-browser .dfb-close:hover,#dsh-file-browser .dfb-row:hover,#dsh-file-browser .dfb-side-row:hover{background:var(--dfb-hover)}#dsh-file-browser .dfb-panel-tab[data-active="true"]{background:var(--dfb-active);color:var(--dfb-text)}
#dsh-file-browser .dfb-menu,#dsh-file-browser .dfb-review-mode-menu{background:var(--dfb-l3);color:var(--dfb-text);border-color:var(--dfb-border);box-shadow:0 12px 32px var(--dsw-alias-bg-mask-2,#0003)}#dsh-file-browser .dfb-menu button,#dsh-file-browser .dfb-review-mode-item{color:var(--dfb-text)}#dsh-file-browser .dfb-menu button:hover,#dsh-file-browser .dfb-review-mode-item:hover{background:var(--dfb-hover)}#dsh-file-browser .dfb-menu-sep{background:var(--dfb-border)}
#dsh-file-browser .dfb-filter,#dsh-file-browser .dfb-review-mode{background:var(--dfb-l2);color:var(--dfb-text);border-color:var(--dfb-border)}#dsh-file-browser .dfb-review-mode:hover,#dsh-file-browser .dfb-review-mode[aria-expanded="true"]{background:var(--dfb-hover);border-color:var(--dfb-border)}#dsh-file-browser .dfb-review-mode-item[data-selected="true"]{background:var(--dfb-active);color:var(--dfb-text)}
#dsh-file-browser .dfb-preview-card,#dsh-file-browser .dfb-preview-detail,#dsh-file-browser .dfb-search-results,#dsh-file-browser .dfb-search-note,#dsh-file-browser .dfb-empty,#dsh-file-browser .dfb-review-empty{color:var(--dfb-text-3)}#dsh-file-browser .dfb-preview-title,#dsh-file-browser .dfb-markdown{color:var(--dfb-text)}#dsh-file-browser .dfb-markdown pre{background:var(--dfb-l2)}
#dsh-file-browser .dfb-editor .cm-editor,#dsh-file-browser .dfb-editor .cm-gutters{background:var(--dfb-bg);color:var(--dfb-text)}#dsh-file-browser .dfb-editor .cm-gutters{color:var(--dfb-text-3)}#dsh-file-browser .dfb-editor .cm-activeLine,#dsh-file-browser .dfb-editor .cm-activeLineGutter{background:var(--dfb-hover)}#dsh-file-browser .dfb-editor .cm-selectionBackground{background:var(--dsw-alias-state-business-tertiary,#c9dcff)!important}
#dsh-file-browser .dfb-review{background:var(--dfb-bg);color:var(--dfb-text)}#dsh-file-browser .dfb-review-toolbar{background:color-mix(in srgb,var(--dfb-bg) 94%,transparent);border-color:var(--dfb-border)}#dsh-file-browser .dfb-review-summary,#dsh-file-browser .dfb-diff-file,#dsh-file-browser .dfb-git-list{background:var(--dfb-l1);border-color:var(--dfb-border)}#dsh-file-browser .dfb-review-summary-title,#dsh-file-browser .dfb-diff-title{background:var(--dfb-l2);color:var(--dfb-text)}#dsh-file-browser .dfb-review-summary-title:hover,#dsh-file-browser .dfb-diff-title:hover,#dsh-file-browser .dfb-status-row:hover{background:var(--dfb-hover)}#dsh-file-browser .dfb-status-row,#dsh-file-browser .dfb-git-row{border-color:var(--dfb-border-soft)}
#dsh-file-browser .dfb-git-primary{color:var(--dfb-text)}#dsh-file-browser .dfb-git-secondary,#dsh-file-browser .dfb-diff-meta .dfb-diff-code{color:var(--dfb-text-3)}#dsh-file-browser .dfb-review-add,#dsh-file-browser .dfb-file-add{color:var(--dfb-success)}#dsh-file-browser .dfb-review-del,#dsh-file-browser .dfb-file-del{color:var(--dfb-danger)}#dsh-file-browser .dfb-git-ref{color:var(--dfb-warn)}
#dsh-file-browser .dfb-diff-num{background:var(--dfb-l2);color:var(--dfb-text-3);border-color:var(--dfb-border-soft)}#dsh-file-browser .dfb-diff-gutter-head,#dsh-file-browser .dfb-diff-gutter-head .dfb-diff-num,#dsh-file-browser .dfb-diff-gutter-head .dfb-diff-code{background:var(--dfb-l3);color:var(--dfb-text-2)}#dsh-file-browser .dfb-diff-add{background:var(--dfb-success-bg)}#dsh-file-browser .dfb-diff-add .dfb-diff-code{color:var(--dfb-success)}#dsh-file-browser .dfb-diff-del{background:color-mix(in srgb,var(--dfb-danger) 12%,var(--dfb-bg))}#dsh-file-browser .dfb-diff-del .dfb-diff-code{color:var(--dfb-danger)}#dsh-file-browser .dfb-diff-hunk{background:var(--dsw-alias-state-business-tertiary,#dbe8ff)}#dsh-file-browser .dfb-diff-hunk .dfb-diff-code{color:var(--dfb-brand)}
#dsh-file-browser .dfb-git-action{border-color:var(--dfb-border);color:var(--dfb-text-2)}#dsh-file-browser .dfb-git-action:hover{background:var(--dfb-hover);color:var(--dfb-text)}#dsh-file-browser .dfb-console,#dsh-file-browser .dfb-console .xterm-viewport{background:var(--dfb-bg)!important}
.dfb-themed-overlay{--dfb-l3:var(--dsw-alias-bg-layer-3,#fff);--dfb-hover:var(--dsw-alias-interactive-bg-hover,#0000000f);--dfb-border:var(--dsw-alias-border-l2,#0000001a);--dfb-text:var(--dsw-alias-label-primary,#171719);background:var(--dfb-l3)!important;color:var(--dfb-text)!important;border-color:var(--dfb-border)!important;box-shadow:0 12px 32px var(--dsw-alias-bg-mask-2,#0003)!important}.dfb-themed-overlay button,.dfb-themed-overlay .dfb-menu button{color:var(--dfb-text)!important}.dfb-themed-overlay button:hover,.dfb-themed-overlay .dfb-menu button:hover{background:var(--dfb-hover)!important}.dfb-themed-overlay .dfb-menu{background:var(--dfb-l3)!important;color:var(--dfb-text)!important;border-color:var(--dfb-border)!important}.dfb-themed-overlay .dfb-menu-sep{background:var(--dfb-border)!important}
`

async function api(sessionId: string, action: 'list' | 'preview' | 'search', path = ''): Promise<ApiResponse> {
  const query = new URLSearchParams({ sessionId, action, path })
  const response = await fetch(`${FILE_BROWSER_ROUTE}?${query}`, { cache: 'no-store' })
  return await response.json() as ApiResponse
}

async function postApi(body: Record<string, unknown>): Promise<ApiResponse> {
  const response = await fetch(FILE_BROWSER_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return await response.json() as ApiResponse
}

function button(label: string, icon: string): HTMLButtonElement {
  const el = document.createElement('button'); el.className = 'dfb-row'; el.type = 'button'
  const i = document.createElement('span'); i.textContent = icon
  const text = document.createElement('span'); text.textContent = label
  el.append(i, text); return el
}

function fileIcon(name: string, directory = false): HTMLElement {
  const icon = document.createElement('span'); icon.className = 'dfb-file-icon'
  if (directory) {
    icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#d8a629" d="M2.8 6.5c0-1 .8-1.8 1.8-1.8h5l2 2.2h7.8c1 0 1.8.8 1.8 1.8v8.8c0 1-.8 1.8-1.8 1.8H4.6c-1 0-1.8-.8-1.8-1.8v-11Z"/><path fill="#f0c34b" d="M2.8 9h18.4l-1.7 9.2c-.1.7-.8 1.2-1.5 1.2H4.5c-.8 0-1.4-.6-1.5-1.3L2.8 9Z"/></svg>'
    return icon
  }
  const extension = name.split('.').at(-1)?.toLowerCase()
  if (extension === 'py') icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#3776ab" d="M12 2c-5 0-5 2.2-5 4v3h10V7H9V6c0-1 .8-1 1.5-1H13V3.5c0-.8-.4-1.5-1-1.5Z"/><path fill="#ffd343" d="M12 22c5 0 5-2.2 5-4v-3H7v2h8v1c0 1-.8 1-1.5 1H11v1.5c0 .8.4 1.5 1 1.5Z"/><circle cx="10" cy="5.5" r=".8" fill="white"/><circle cx="14" cy="18.5" r=".8" fill="white"/></svg>'
  else if (['js', 'jsx', 'mjs', 'cjs'].includes(extension ?? '')) { icon.className += ' dfb-file-badge dfb-icon-js'; icon.textContent = 'JS' }
  else if (['ts', 'tsx'].includes(extension ?? '')) { icon.className += ' dfb-file-badge dfb-icon-ts'; icon.textContent = 'TS' }
  else if (extension === 'json') { icon.className += ' dfb-icon-json'; icon.textContent = '{}' }
  else if (['md', 'mdx', 'markdown'].includes(extension ?? '')) { icon.className += ' dfb-icon-md'; icon.textContent = 'M↓' }
  else if (['yaml', 'yml'].includes(extension ?? '')) { icon.className += ' dfb-icon-yaml'; icon.textContent = 'Y' }
  else if (['sh', 'bash', 'zsh', 'ps1'].includes(extension ?? '')) { icon.className += ' dfb-file-badge dfb-icon-shell'; icon.textContent = '>_' }
  else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(extension ?? '')) icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="#9b72cf"/><circle cx="9" cy="9" r="2" fill="#e8ddf5"/><path d="m5 18 5-5 3 3 2-2 4 4" fill="none" stroke="#fff" stroke-width="1.5"/></svg>'
  else if (['conf', 'config', 'ini', 'env', 'toml'].includes(extension ?? '') || name.startsWith('.')) { icon.className += ' dfb-icon-config'; icon.textContent = '⚙' }
  else { icon.className += ' dfb-icon-generic'; icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.8h8l4 4v14.4H6V2.8Z" fill="#89919d"/><path d="M14 2.8v4h4" fill="none" stroke="#dce0e5" stroke-width="1.2"/></svg>' }
  return icon
}

type ResolvedPath = Extract<ApiResponse, { ok: true; path: string }>
type ReviewData = Extract<ApiResponse, { ok: true; review: unknown }>['review']

function editorUri(editor: 'vscode' | 'cursor', target: ResolvedPath): string {
  const normalized = target.path.replaceAll('\\', '/')
  const encoded = encodeURI(normalized).replaceAll('#', '%23').replaceAll('?', '%3F')
  if (target.distro !== undefined) {
    return `${editor}://vscode-remote/wsl+${encodeURIComponent(target.distro)}${encoded.startsWith('/') ? encoded : `/${encoded}`}`
  }
  return `${editor}://file${encoded.startsWith('/') ? encoded : `/${encoded}`}`
}

function openBrowserProtocol(uri: string): void {
  const link = document.createElement('a')
  link.href = uri
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
}

// PATCH(2026-08-21) markdown preview: syntax-highlight code fences with the lezer
// parsers already bundled for CodeMirror (zero new dependencies). A local
// tagHighlighter emits stable "tok-*" class names (same vocabulary as
// @lezer/highlight's classHighlighter); colours live in markdownCss (theme adaptive).
const dfbTokHighlighter = tagHighlighter([
  { tag: tags.link, class: 'tok-link' },
  { tag: tags.heading, class: 'tok-heading' },
  { tag: tags.emphasis, class: 'tok-emphasis' },
  { tag: tags.strong, class: 'tok-strong' },
  { tag: tags.keyword, class: 'tok-keyword' },
  { tag: tags.atom, class: 'tok-atom' },
  { tag: tags.bool, class: 'tok-bool' },
  { tag: tags.url, class: 'tok-url' },
  { tag: tags.labelName, class: 'tok-labelName' },
  { tag: tags.inserted, class: 'tok-inserted' },
  { tag: tags.deleted, class: 'tok-deleted' },
  { tag: tags.literal, class: 'tok-literal' },
  { tag: tags.string, class: 'tok-string' },
  { tag: tags.number, class: 'tok-number' },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: 'tok-string2' },
  { tag: tags.function(tags.variableName), class: 'tok-functionName' },
  { tag: tags.variableName, class: 'tok-variableName' },
  { tag: tags.local(tags.variableName), class: 'tok-variableName tok-local' },
  { tag: tags.definition(tags.variableName), class: 'tok-variableName tok-definition' },
  { tag: tags.special(tags.variableName), class: 'tok-variableName2' },
  { tag: tags.definition(tags.propertyName), class: 'tok-propertyName tok-definition' },
  { tag: tags.typeName, class: 'tok-typeName' },
  { tag: tags.namespace, class: 'tok-namespace' },
  { tag: tags.className, class: 'tok-className' },
  { tag: tags.macroName, class: 'tok-macroName' },
  { tag: tags.propertyName, class: 'tok-propertyName' },
  { tag: tags.operator, class: 'tok-operator' },
  { tag: tags.comment, class: 'tok-comment' },
  { tag: tags.meta, class: 'tok-meta' },
  { tag: tags.invalid, class: 'tok-invalid' },
  { tag: tags.punctuation, class: 'tok-punctuation' }
], {})

function dfbEscapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function dfbMarkdownLanguage(lang: string): Language | null {
  const extensionMap: Record<string, string> = {
    js: '.js', jsx: '.jsx', mjs: '.mjs', cjs: '.cjs', ts: '.ts', tsx: '.tsx',
    python: '.py', py: '.py', md: '.md', markdown: '.md',
    json: '.json', jsonc: '.jsonc', css: '.css', scss: '.scss', less: '.less',
    html: '.html', htm: '.html', vue: '.vue', svelte: '.svelte'
  }
  const extension = extensionMap[lang.toLowerCase()]
  if (!extension) return null
  const support = languageFor(extension)
  const list: Extension[] = Array.isArray(support) ? support : [support]
  for (const entry of list) {
    if ((entry as { language?: Language }).language?.parser) return (entry as { language: Language }).language
  }
  return null
}

function dfbHighlightCode(code: string, language: Language): string {
  const tree = language.parser.parse(code)
  let result = ''
  let last = 0
  highlightTree(tree, dfbTokHighlighter, (from, to, classes) => {
    if (from > last) result += dfbEscapeHtml(code.slice(last, from))
    if (classes) result += `<span class="${classes}">${dfbEscapeHtml(code.slice(from, to))}</span>`
    else result += dfbEscapeHtml(code.slice(from, to))
    last = to
  })
  if (last < code.length) result += dfbEscapeHtml(code.slice(last))
  return result
}

function dfbRenderMarkdown(content: string): string {
  let html: string
  try { html = marked.parse(content) as string } catch { html = String(content) }
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const blocks = parsed.querySelectorAll('pre code[class*="language-"]')
    for (const element of blocks) {
      const match = (element.className || '').match(/language-([A-Za-z0-9_+-]+)/)
      if (!match) continue
      const pre = element.closest('pre')
      if (!pre) continue
      const languageName = match[1]
      if (languageName.toLowerCase() === 'mermaid') {
        const holder = document.createElement('div')
        holder.className = 'dfb-mermaid'
        holder.setAttribute('data-src', encodeURIComponent(element.textContent))
        pre.replaceWith(holder)
        continue
      }
      pre.setAttribute('data-df-lang', languageName)
      const language = dfbMarkdownLanguage(languageName)
      if (!language) continue
      const code = element.textContent
      if (code.length > 65536) continue
      try { element.innerHTML = dfbHighlightCode(code, language) } catch { /* keep plain text */ }
    }
    html = parsed.body.innerHTML
  } catch { /* keep marked output */ }
  return html
}

// PATCH(2026-08-21) mermaid preview: ```mermaid fences are rendered on demand by
// lazily loading the mermaid engine (jsdelivr, fallback unpkg) only when such a
// fence exists; if the engine cannot load (offline/CSP) or the diagram fails,
// the block gracefully falls back to showing the raw source.
let dfbMermaidPromise: Promise<any> | null = null
let dfbMermaidSequence = 0

function dfbMermaidTheme(): string {
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'default'
}

function dfbLoadMermaid(): Promise<any> {
  if ((window as any).mermaid && typeof (window as any).mermaid.render === 'function') return Promise.resolve((window as any).mermaid)
  if (dfbMermaidPromise) return dfbMermaidPromise
  dfbMermaidPromise = new Promise((resolve, reject) => {
    const sources = [
      'https://cdn.jsdelivr.net/npm/mermaid@11.17.0/dist/mermaid.min.js',
      'https://unpkg.com/mermaid@11.17.0/dist/mermaid.min.js'
    ]
    let index = 0
    const tryLoad = () => {
      if (index >= sources.length) { dfbMermaidPromise = null; reject(new Error('mermaid load failed')); return }
      const script = document.createElement('script')
      script.src = sources[index++]
      script.onload = () => {
        if (!((window as any).mermaid && typeof (window as any).mermaid.render === 'function')) { script.remove(); tryLoad(); return }
        (window as any).mermaid.initialize({ startOnLoad: false, theme: dfbMermaidTheme() })
        resolve((window as any).mermaid)
      }
      script.onerror = () => { script.remove(); tryLoad() }
      document.head.append(script)
    }
    tryLoad()
    window.setTimeout(() => {
      if (!((window as any).mermaid && typeof (window as any).mermaid.render === 'function') && dfbMermaidPromise !== null) {
        dfbMermaidPromise = null
        reject(new Error('mermaid load timeout'))
      }
    }, 12000)
  })
  return dfbMermaidPromise
}

function dfbDecodeMermaidSource(block: HTMLElement): string {
  const raw = block.dataset.src
  if (!raw) return block.textContent || ''
  try { return decodeURIComponent(raw) } catch { return block.textContent || '' }
}

function dfbMermaidFallback(block: HTMLElement): void {
  block.replaceChildren()
  const note = document.createElement('div')
  note.className = 'dfb-mermaid-note'
  note.textContent = 'mermaid 渲染不可用（需要联网加载渲染引擎，或图表语法有误）。以下为源码：'
  const pre = document.createElement('pre')
  pre.className = 'dfb-mermaid-fallback'
  pre.textContent = dfbDecodeMermaidSource(block)
  block.append(note, pre)
}

function dfbRenderMermaidBlocks(root: HTMLElement): void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.dfb-mermaid[data-src]')).filter(block => block.isConnected)
  if (blocks.length === 0) return
  dfbLoadMermaid().then((mermaid) => {
    mermaid.initialize({ startOnLoad: false, theme: dfbMermaidTheme() })
    let chain: Promise<void> = Promise.resolve()
    for (const block of blocks) {
      chain = chain.then(async () => {
        if (!block.isConnected) return
        block.innerHTML = '<div class="dfb-mermaid-loading">渲染中…</div>'
        try {
          const id = `dfb-mm-${Date.now().toString(36)}-${++dfbMermaidSequence}`
          const rendered = await mermaid.render(id, dfbDecodeMermaidSource(block))
          block.innerHTML = DOMPurify.sanitize(rendered.svg, { USE_PROFILES: { svg: true, svgFilters: true } })
        } catch { dfbMermaidFallback(block) }
      })
    }
    return chain
  }).catch(() => {
    for (const block of blocks) dfbMermaidFallback(block)
  })
}

function languageFor(extension: string): Extension {
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) return javascript({ jsx: true })
  if (['.ts', '.tsx'].includes(extension)) return javascript({ jsx: extension === '.tsx', typescript: true })
  if (extension === '.py') return python()
  if (['.md', '.markdown'].includes(extension)) return markdown()
  if (['.json', '.jsonc'].includes(extension)) return json()
  if (['.css', '.scss', '.less'].includes(extension)) return cssLanguage()
  if (['.html', '.htm', '.vue', '.svelte'].includes(extension)) return html()
  return []
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function renderPreviewMessage(host: HTMLElement, title: string, detail: string, icon = 'ⓘ'): void {
  host.replaceChildren()
  host.style.position = 'relative'
  const message = document.createElement('div'); message.className = 'dfb-preview-message'
  const card = document.createElement('div'); card.className = 'dfb-preview-card'
  const symbol = document.createElement('div'); symbol.className = 'dfb-preview-icon'; symbol.textContent = icon
  const heading = document.createElement('div'); heading.className = 'dfb-preview-title'; heading.textContent = title
  const description = document.createElement('div'); description.className = 'dfb-preview-detail'; description.textContent = detail
  card.append(symbol, heading, description); message.append(card); host.append(message)
}

function renderPreview(host: HTMLElement, value: Preview, save: (content: string) => Promise<void>): void {
  const previousEditor = activeEditors.get(host)
  if (previousEditor !== undefined) { previousEditor.view.destroy(); activeEditors.delete(host) }
  host.replaceChildren()
  if (value.kind === 'image') {
    const image = document.createElement('img'); image.className = 'dfb-image'; image.src = value.dataUrl; image.alt = value.name; host.append(image); return
  }
  if (value.kind === 'empty') { renderPreviewMessage(host, '空文件', `${value.name} 没有可预览的内容。`, '◇'); return }
  if (value.kind === 'binary') { renderPreviewMessage(host, '暂不支持预览此文件', `${value.name} 是二进制文件（${formatBytes(value.size)}）。可以右键使用系统默认应用打开。`, '▣'); return }
  if (value.kind === 'too-large') { renderPreviewMessage(host, '文件过大，无法预览', `${value.name} 的大小为 ${formatBytes(value.size)}，已超过预览限制。`, '⚠'); return }
  if (value.extension === '.md' || value.extension === '.markdown') {
    const article = document.createElement('article'); article.className = 'dfb-markdown'
    article.innerHTML = DOMPurify.sanitize(dfbRenderMarkdown(value.content))
    host.append(article)
    dfbRenderMermaidBlocks(article)
    return
  }
  host.style.position = 'relative'
  const editor = document.createElement('div'); editor.className = 'dfb-editor'
  let saveTimer: number | undefined
  let saving = Promise.resolve()
  let editorView: EditorView
  const highlightTheme = new Compartment()
  const saveNow = (): void => {
    if (saveTimer !== undefined) window.clearTimeout(saveTimer)
    const content = editorView.state.doc.toString()
    saving = saving.then(() => save(content)).catch(error => { console.error('side-panel autosave failed', error) })
  }
  editorView = new EditorView({
    parent: editor,
    doc: value.content,
    extensions: [
      basicSetup,
      languageFor(value.extension),
      highlightTheme.of(syntaxHighlighting(document.body.hasAttribute('data-ds-dark-theme') ? oneDarkHighlightStyle : defaultHighlightStyle)),
      EditorView.lineWrapping,
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return
        if (saveTimer !== undefined) window.clearTimeout(saveTimer)
        saveTimer = window.setTimeout(saveNow, 500)
      }),
    ],
  })
  activeEditors.set(host, { view: editorView, theme: highlightTheme })
  editor.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveNow() } })
  host.append(editor)
}

const activeEditors = new Map<HTMLElement, { view: EditorView; theme: Compartment }>()

function refreshEditorThemes(): void {
  const style = document.body.hasAttribute('data-ds-dark-theme') ? oneDarkHighlightStyle : defaultHighlightStyle
  for (const { view, theme } of activeEditors.values()) view.dispatch({ effects: theme.reconfigure(syntaxHighlighting(style)) })
}

function renderReview(host: HTMLElement, review: ReviewData, changeMode: (mode: ReviewMode) => void, mutateFile: (action: 'git-stage' | 'git-unstage', path: string) => void): void {
  host.replaceChildren()
  const { status, diff } = review
  const additions = diff.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).length
  const deletions = diff.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).length
  const toolbar = document.createElement('div'); toolbar.className = 'dfb-review-toolbar'
  const modeLabels: Record<ReviewMode, string> = { unstaged: `未暂存 ${review.counts.unstaged}`, staged: `已暂存 ${review.counts.staged}`, commits: '提交记录', branches: '分支', 'last-session': '上轮会话修改' }
  const modeWrap = document.createElement('div'); modeWrap.className = 'dfb-review-mode-wrap'
  const mode = document.createElement('button'); mode.type = 'button'; mode.className = 'dfb-review-mode'; mode.title = '选择审查范围'; mode.setAttribute('aria-expanded', 'false')
  const modeText = document.createElement('span'); modeText.textContent = modeLabels[review.mode]
  const modeArrow = document.createElement('span'); modeArrow.className = 'dfb-review-mode-arrow'; modeArrow.textContent = '▼'
  mode.append(modeText, modeArrow)
  const modeMenu = document.createElement('div'); modeMenu.className = 'dfb-review-mode-menu'; modeMenu.hidden = true
  const closeModeMenu = (): void => { modeMenu.hidden = true; mode.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', dismissModeMenu) }
  const dismissModeMenu = (event: PointerEvent): void => { if (!modeWrap.contains(event.target as Node)) closeModeMenu() }
  for (const value of Object.keys(modeLabels) as ReviewMode[]) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'dfb-review-mode-item'; item.dataset.selected = String(value === review.mode)
    const label = document.createElement('span'); label.textContent = modeLabels[value]
    const check = document.createElement('span'); check.className = 'dfb-review-mode-check'; check.textContent = value === review.mode ? '✓' : ''
    item.append(label, check); item.onclick = () => { closeModeMenu(); if (value !== review.mode) changeMode(value) }; modeMenu.append(item)
  }
  mode.onclick = () => { const open = modeMenu.hidden; if (open) { modeMenu.hidden = false; mode.setAttribute('aria-expanded', 'true'); queueMicrotask(() => document.addEventListener('pointerdown', dismissModeMenu)) } else closeModeMenu() }
  modeWrap.append(mode, modeMenu)
  const count = document.createElement('span'); count.className = 'dfb-review-count'; count.textContent = review.mode === 'commits' ? String(review.commits.length) : review.mode === 'branches' ? String(review.branches.length) : String(status.split('\n').filter(Boolean).length)
  const added = document.createElement('span'); added.className = 'dfb-review-add'; added.textContent = `+${additions}`
  const removed = document.createElement('span'); removed.className = 'dfb-review-del'; removed.textContent = `-${deletions}`
  const branch = document.createElement('span'); branch.className = 'dfb-review-branch'; branch.textContent = `⑂ ${review.branch || 'detached'}`
  toolbar.append(modeWrap, count, added, removed, branch); host.append(toolbar)
  if (review.mode === 'commits') {
    const list = document.createElement('div'); list.className = 'dfb-git-list'
    for (const commit of review.commits) { const row = document.createElement('div'); row.className = 'dfb-git-row'; const hash = document.createElement('span'); hash.className = 'dfb-git-ref'; hash.textContent = commit.shortHash; const main = document.createElement('div'); const subject = document.createElement('div'); subject.className = 'dfb-git-primary'; subject.textContent = commit.subject; const meta = document.createElement('div'); meta.className = 'dfb-git-secondary'; meta.textContent = `${commit.author} · ${commit.relativeDate}${commit.refs === '' ? '' : ` · ${commit.refs}`}`; main.append(subject, meta); row.append(hash, main); list.append(row) }
    if (review.commits.length === 0) list.innerHTML = '<div class="dfb-review-empty">当前分支没有提交记录</div>'
    host.append(list); return
  }
  if (review.mode === 'branches') {
    const list = document.createElement('div'); list.className = 'dfb-git-list'
    for (const item of review.branches) { const row = document.createElement('div'); row.className = 'dfb-git-row'; const marker = document.createElement('span'); marker.className = 'dfb-git-ref'; marker.textContent = item.current ? '●' : '○'; const main = document.createElement('div'); const name = document.createElement('div'); name.className = 'dfb-git-primary'; name.textContent = item.name; const meta = document.createElement('div'); meta.className = 'dfb-git-secondary'; meta.textContent = `${item.upstream || '无上游'}${item.subject === '' ? '' : ` · ${item.subject}`}`; main.append(name, meta); const track = document.createElement('span'); track.className = 'dfb-git-secondary'; track.textContent = `${item.ahead > 0 ? `↑${item.ahead}` : ''}${item.behind > 0 ? ` ↓${item.behind}` : ''}`; row.append(marker, main, track); list.append(row) }
    host.append(list); return
  }
  if (review.mode === 'last-session' && review.message !== undefined) { const empty = document.createElement('div'); empty.className = 'dfb-review-empty'; empty.textContent = review.message; host.append(empty); return }
  const diffFiles = new Map<string, { section: HTMLElement; body: HTMLElement; disclosure: HTMLElement }>()
  const statusLines = status.split('\n').filter(line => line.trim() !== '')
  if (statusLines.length > 0) {
    const summary = document.createElement('section'); summary.className = 'dfb-review-summary'
    const title = document.createElement('button'); title.type = 'button'; title.className = 'dfb-review-summary-title'
    const disclosure = document.createElement('span'); disclosure.className = 'dfb-review-disclosure'; disclosure.textContent = '▾'
    const rangeLabel = review.mode === 'staged' ? '已暂存' : review.mode === 'last-session' ? '上轮会话修改' : '未暂存'
    const titleText = document.createElement('span'); titleText.textContent = `${rangeLabel}文件（${statusLines.length}）`; title.append(disclosure, titleText)
    const summaryBody = document.createElement('div'); summaryBody.className = 'dfb-review-summary-body'
    title.onclick = () => { summaryBody.hidden = !summaryBody.hidden; disclosure.textContent = summaryBody.hidden ? '▸' : '▾' }
    summary.append(title, summaryBody)
    for (const line of statusLines) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'dfb-status-row'
      const code = document.createElement('span'); code.className = 'dfb-status-code'; code.textContent = line.slice(0, 2).trim() || 'M'
      if (line.startsWith('??') || line.includes('A')) code.dataset.kind = 'new'
      else if (line.includes('D')) code.dataset.kind = 'deleted'
      const rawPath = line.slice(3); const filePath = rawPath.split(' -> ').at(-1) ?? rawPath
      const path = document.createElement('span'); path.className = 'dfb-status-path'; path.textContent = rawPath
      row.onclick = () => {
        const target = diffFiles.get(filePath); if (target === undefined) return
        for (const item of diffFiles.values()) item.section.dataset.selected = 'false'
        target.body.hidden = false; target.disclosure.textContent = '▾'; target.section.dataset.selected = 'true'
        target.section.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      row.append(code, path); summaryBody.append(row)
    }
    host.append(summary)
  }

  let file: HTMLElement | undefined
  let fileAdded = 0
  let fileDeleted = 0
  let fileAddedLabel: HTMLElement | undefined
  let fileDeletedLabel: HTMLElement | undefined
  let oldLine = 0
  let newLine = 0
  const appendRow = (kind: 'context' | 'add' | 'del' | 'hunk' | 'meta', text: string, oldNumber?: number, newNumber?: number): void => {
    if (file === undefined) return
    if (kind === 'add') { fileAdded++; if (fileAddedLabel !== undefined) fileAddedLabel.textContent = `+${fileAdded}` }
    if (kind === 'del') { fileDeleted++; if (fileDeletedLabel !== undefined) fileDeletedLabel.textContent = `-${fileDeleted}` }
    const row = document.createElement('div'); row.className = `dfb-diff-row dfb-diff-${kind}`
    const oldCell = document.createElement('span'); oldCell.className = 'dfb-diff-num'; oldCell.textContent = oldNumber === undefined ? '' : String(oldNumber)
    const newCell = document.createElement('span'); newCell.className = 'dfb-diff-num'; newCell.textContent = newNumber === undefined ? '' : String(newNumber)
    const code = document.createElement('span'); code.className = 'dfb-diff-code'; code.textContent = text || ' '
    row.append(oldCell, newCell, code); file.append(row)
  }
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const section = document.createElement('section'); section.className = 'dfb-diff-file'
      const title = document.createElement('div'); title.className = 'dfb-diff-title'
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'dfb-diff-toggle'
      const disclosure = document.createElement('span'); disclosure.className = 'dfb-review-disclosure'; disclosure.textContent = '▾'
      const diffPath = line.match(/ b\/(.*)$/)?.[1] ?? line
      const titleText = document.createElement('span'); titleText.textContent = diffPath
      fileAdded = 0; fileDeleted = 0
      fileAddedLabel = document.createElement('span'); fileAddedLabel.className = 'dfb-file-add'; fileAddedLabel.textContent = '+0'
      fileDeletedLabel = document.createElement('span'); fileDeletedLabel.className = 'dfb-file-del'; fileDeletedLabel.textContent = '-0'
      const action = document.createElement('button'); action.type = 'button'; action.className = 'dfb-git-action'; action.textContent = review.mode === 'staged' ? '−' : '+'; action.title = review.mode === 'staged' ? '取消暂存' : '暂存文件'
      action.onclick = () => mutateFile(review.mode === 'staged' ? 'git-unstage' : 'git-stage', diffPath)
      action.hidden = review.mode === 'last-session'
      const body = document.createElement('div'); body.className = 'dfb-diff-body'; body.hidden = true; file = body; disclosure.textContent = '▸'
      const gutterHead = document.createElement('div'); gutterHead.className = 'dfb-diff-row dfb-diff-gutter-head'
      const oldLabel = document.createElement('span'); oldLabel.className = 'dfb-diff-num'; oldLabel.textContent = '−'; oldLabel.title = '修改前行号'
      const newLabel = document.createElement('span'); newLabel.className = 'dfb-diff-num'; newLabel.textContent = '+'; newLabel.title = '修改后行号'
      const codeLabel = document.createElement('span'); codeLabel.className = 'dfb-diff-code'; codeLabel.textContent = '代码变更'
      gutterHead.append(oldLabel, newLabel, codeLabel); body.append(gutterHead)
      toggle.append(disclosure, titleText); toggle.onclick = () => { body.hidden = !body.hidden; disclosure.textContent = body.hidden ? '▸' : '▾' }
      title.append(toggle, fileAddedLabel, fileDeletedLabel, action)
      section.append(title, body); host.append(section); diffFiles.set(diffPath, { section, body, disclosure }); continue
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk !== null) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); appendRow('hunk', line); continue }
    if (line.startsWith('+') && !line.startsWith('+++')) { appendRow('add', line, undefined, newLine++); continue }
    if (line.startsWith('-') && !line.startsWith('---')) { appendRow('del', line, oldLine++, undefined); continue }
    if (line.startsWith(' ')) { appendRow('context', line, oldLine++, newLine++); continue }
    appendRow('meta', line)
  }
  if (statusLines.length === 0 && diff.trim() === '') {
    const empty = document.createElement('div'); empty.className = 'dfb-review-empty'; empty.textContent = review.mode === 'staged' ? '当前没有已暂存的变更' : review.mode === 'last-session' ? '上轮会话没有产生 Git 变更' : '当前没有未暂存的变更'; host.append(empty)
  }
}

function createPanel(ctx: ClientContext): { root: HTMLElement; openFile(path: string): Promise<void>; dispose(): void } {
  const style = document.createElement('style'); style.textContent = css + reviewCss + themeCss + markdownCss; document.head.append(style)
  const root = document.createElement('aside'); root.id = 'dsh-file-browser'; root.hidden = true
  const hostWorkspaces = ctx.workspaces
  let conversationRoot: HTMLElement | null = null
  let sessionHeader: HTMLElement | null = null
  let priorDisplay = ''
  let priorGridColumns = ''
  let priorGridRows = ''
  let priorHeaderColumn = ''
  let priorHeaderRow = ''
  const widthKey = 'dsh.file-browser.width'
  const defaultWidth = 440
  const storedWidth = Number.parseInt(localStorage.getItem(widthKey) ?? '', 10)
  let panelWidth = Number.isFinite(storedWidth) ? storedWidth : defaultWidth
  const syncGrid = (): void => {
    if (conversationRoot === null || root.hidden) return
    const available = conversationRoot.clientWidth || window.innerWidth
    const max = Math.max(320, Math.floor(available * 0.55))
    panelWidth = Math.min(max, Math.max(320, panelWidth))
    conversationRoot.style.gridTemplateColumns = `minmax(0, 1fr) ${panelWidth}px`
  }
  const restoreConversationLayout = (): void => {
    if (conversationRoot !== null) {
      conversationRoot.style.display = priorDisplay
      conversationRoot.style.gridTemplateColumns = priorGridColumns
      conversationRoot.style.gridTemplateRows = priorGridRows
    }
    if (sessionHeader !== null) {
      sessionHeader.style.gridColumn = priorHeaderColumn
      sessionHeader.style.gridRow = priorHeaderRow
    }
  }
  const attachConversation = (candidate: HTMLElement, header: HTMLElement): void => {
    if (conversationRoot === candidate) return
    restoreConversationLayout()
    conversationRoot = candidate
    sessionHeader = header
    priorDisplay = candidate.style.display
    priorGridColumns = candidate.style.gridTemplateColumns
    priorGridRows = candidate.style.gridTemplateRows
    priorHeaderColumn = header.style.gridColumn
    priorHeaderRow = header.style.gridRow
    candidate.style.display = 'grid'
    candidate.style.gridTemplateRows = 'auto minmax(0, 1fr)'
    header.style.gridColumn = '1 / -1'
    header.style.gridRow = '1'
    candidate.append(root)
    syncGrid()
  }
  const applyWidth = (): void => {
    syncGrid()
  }
  applyWidth()
  const resizer = document.createElement('div'); resizer.className = 'dfb-resizer'; resizer.setAttribute('role', 'separator'); resizer.setAttribute('aria-label', '调整文件浏览器宽度')
  let startX = 0; let startWidth = panelWidth
  const pointerMove = (event: PointerEvent): void => { panelWidth = startWidth + startX - event.clientX; applyWidth() }
  const pointerUp = (): void => { resizer.dataset.dragging = 'false'; resizer.releasePointerCapture?.(Number(resizer.dataset.pointer)); localStorage.setItem(widthKey, String(panelWidth)); window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', pointerUp) }
  resizer.onpointerdown = (event) => { startX = event.clientX; startWidth = panelWidth; resizer.dataset.dragging = 'true'; resizer.dataset.pointer = String(event.pointerId); resizer.setPointerCapture?.(event.pointerId); window.addEventListener('pointermove', pointerMove); window.addEventListener('pointerup', pointerUp) }
  resizer.ondblclick = () => { panelWidth = defaultWidth; applyWidth(); localStorage.setItem(widthKey, String(panelWidth)) }
  const head = document.createElement('header'); head.className = 'dfb-head'
  const panelTabs = document.createElement('div'); panelTabs.className = 'dfb-panel-tabs'
  const content = document.createElement('div'); content.className = 'dfb-content'
  type PanelKind = 'review' | 'terminal' | 'files'
  const labels: Record<PanelKind, string> = { review: '审查', terminal: '终端', files: '文件' }
  const views = new Map<PanelKind, HTMLElement>()
  const tabButtons = new Map<PanelKind, HTMLButtonElement>()
  const openKinds = new Set<PanelKind>(['files'])
  let activeKind: PanelKind = 'files'
  let scheduleFeatureLabel: (kind: PanelKind) => void = () => {}
  const selectKind = (kind: PanelKind): void => {
    openKinds.add(kind); const selectedTab = tabButtons.get(kind); if (selectedTab !== undefined) selectedTab.hidden = false
    activeKind = kind
    for (const [key, view] of views) view.hidden = key !== kind
    for (const [key, tab] of tabButtons) tab.dataset.active = String(key === kind)
    scheduleFeatureLabel(kind)
    if (kind === 'review') void refreshReview()
    if (kind === 'terminal') void ensureTerminal()
  }
  for (const kind of ['review', 'terminal', 'files'] as const) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'dfb-panel-tab'; tab.dataset.active = String(kind === activeKind); tab.hidden = !openKinds.has(kind)
    const label = document.createElement('span'); label.textContent = labels[kind]
    const closeTab = document.createElement('span'); closeTab.textContent = '　×'; closeTab.title = '关闭标签'; closeTab.onclick = event => { event.stopPropagation(); openKinds.delete(kind); tab.hidden = true; if (activeKind === kind) { const next = [...openKinds].at(-1); if (next !== undefined) selectKind(next); else closePanel() } }
    tab.append(label, closeTab); tab.onclick = () => selectKind(kind); panelTabs.append(tab); tabButtons.set(kind, tab)
  }
  const tools = document.createElement('div'); tools.className = 'dfb-tools'
  const addTab = document.createElement('button'); addTab.className = 'dfb-tool'; addTab.type = 'button'; addTab.textContent = '+'; addTab.title = '新建功能标签'
  const expand = document.createElement('button'); expand.className = 'dfb-tool'; expand.type = 'button'; expand.textContent = '⛶'; expand.title = '展开/恢复面板'
  const close = document.createElement('button'); close.className = 'dfb-close'; close.type = 'button'; close.textContent = '×'; close.title = '关闭'
  tools.append(addTab, expand, close); head.append(panelTabs, tools)
  const body = document.createElement('div'); body.className = 'dfb-body'
  body.dataset.tree = 'true'
  const filesView = document.createElement('section'); filesView.className = 'dfb-files dfb-view'
  const fileToolbar = document.createElement('div'); fileToolbar.className = 'dfb-file-toolbar'
  const currentPath = document.createElement('div'); currentPath.className = 'dfb-path'; currentPath.textContent = '当前工作区'
  const refreshTree = document.createElement('button'); refreshTree.className = 'dfb-tool'; refreshTree.type = 'button'; refreshTree.textContent = '↻'; refreshTree.title = '刷新目录树'
  const toggleTree = document.createElement('button'); toggleTree.className = 'dfb-tool'; toggleTree.type = 'button'; toggleTree.textContent = '▤'; toggleTree.title = '收起/展开目录树'
  fileToolbar.append(currentPath, refreshTree, toggleTree)
  const preview = document.createElement('div'); preview.className = 'dfb-preview'; preview.innerHTML = '<div class="dfb-empty">从文件树选择文件</div>'
  const treePane = document.createElement('aside'); treePane.className = 'dfb-tree-pane'
  const filter = document.createElement('input'); filter.className = 'dfb-filter'; filter.placeholder = '筛选文件...'
  const tree = document.createElement('div'); tree.className = 'dfb-tree'
  const searchResults = document.createElement('div'); searchResults.className = 'dfb-tree dfb-search-results'; searchResults.hidden = true
  let searchTimer: number | undefined
  let searchRequest = 0
  filter.oninput = () => {
    if (searchTimer !== undefined) window.clearTimeout(searchTimer)
    const query = filter.value.trim(); const request = ++searchRequest
    tree.hidden = query !== ''; searchResults.hidden = query === ''
    if (query === '') { searchResults.replaceChildren(); return }
    searchResults.textContent = '正在搜索工作区…'
    searchTimer = window.setTimeout(() => {
      const sessionId = currentSession()
      if (sessionId === undefined) { searchResults.textContent = '当前没有打开的会话'; return }
      void api(sessionId, 'search', query).then(response => {
        if (request !== searchRequest) return
        searchResults.replaceChildren()
        if (!response.ok || !('matches' in response)) { searchResults.textContent = response.ok ? '没有搜索结果' : response.error; return }
        if (response.matches.length === 0) { searchResults.textContent = '没有匹配的文件'; return }
        for (const entry of response.matches) {
          const row = button(entry.path, ''); row.firstElementChild!.replaceWith(fileIcon(entry.name)); row.title = entry.path
          row.onclick = () => { void openFile(entry.path) }; searchResults.append(row)
        }
        if (response.truncated) { const note = document.createElement('div'); note.className = 'dfb-search-note'; note.textContent = `仅显示前 ${response.matches.length} 条结果，请输入更精确的关键词`; searchResults.append(note) }
      })
    }, 200)
  }
  treePane.append(filter, tree, searchResults); body.append(preview, treePane); filesView.append(fileToolbar, body); views.set('files', filesView)
  const review = document.createElement('div'); review.className = 'dfb-review dfb-view'; views.set('review', review)
  const terminal = document.createElement('div'); terminal.className = 'dfb-console dfb-view'; views.set('terminal', terminal)
  for (const [kind, view] of views) { view.classList.add('dfb-view'); view.hidden = kind !== activeKind; content.append(view) }
  root.append(resizer, head, content)
  document.body.append(root)
  const contextMenu = document.createElement('div'); contextMenu.className = 'dfb-menu dfb-themed-overlay'; contextMenu.hidden = true; document.body.append(contextMenu)
  const addMenu = document.createElement('div'); addMenu.className = 'dfb-menu dfb-themed-overlay'; addMenu.hidden = true; document.body.append(addMenu)
  for (const kind of ['review', 'terminal', 'files'] as const) { const item = document.createElement('button'); item.textContent = labels[kind]; item.onclick = () => { addMenu.hidden = true; selectKind(kind) }; addMenu.append(item) }
  addTab.onclick = event => { const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); addMenu.style.left = `${Math.max(8, rect.right - 220)}px`; addMenu.style.top = `${rect.bottom + 4}px`; addMenu.hidden = !addMenu.hidden }
  const hideMenu = (): void => { contextMenu.hidden = true; contextMenu.replaceChildren() }
  const openContextMenu = async (entry: BrowserEntry, x: number, y: number): Promise<void> => {
    contextMenu.replaceChildren(); contextMenu.hidden = false; contextMenu.style.left = `${Math.min(x, window.innerWidth - 240)}px`; contextMenu.style.top = `${Math.min(y, window.innerHeight - 250)}px`
    const action = (label: string, runAction: () => void): HTMLButtonElement => { const item = document.createElement('button'); item.type = 'button'; item.textContent = label; item.onclick = () => { hideMenu(); runAction() }; return item }
    const sessionId = currentSession(); if (sessionId === undefined) return
    const loading = document.createElement('button'); loading.type = 'button'; loading.disabled = true; loading.textContent = '正在解析路径…'; contextMenu.append(loading)
    const response = await postApi({ sessionId, action: 'resolve-path', path: entry.path })
    if (!response.ok || !('path' in response)) {
      contextMenu.replaceChildren()
      const failed = document.createElement('button'); failed.type = 'button'; failed.disabled = true; failed.textContent = response.ok ? '无法解析路径' : response.error; contextMenu.append(failed)
      return
    }
    if (contextMenu.hidden) return
    const resolved = response
    contextMenu.replaceChildren()
    const revealPath = entry.kind === 'directory' ? resolved.path : resolved.parentPath
    contextMenu.append(action('📂  在文件管理器中打开', () => { void hostWorkspaces.openPath(revealPath).catch(error => console.error('side-panel host.openPath failed', error)) }))
    const openWith = document.createElement('button'); openWith.textContent = '　打开方式　›'
    const submenu = document.createElement('div'); submenu.className = 'dfb-menu dfb-submenu'; submenu.hidden = true
    submenu.append(
      action('VS Code', () => openBrowserProtocol(editorUri('vscode', resolved))),
      action('Cursor', () => openBrowserProtocol(editorUri('cursor', resolved))),
      action('默认应用', () => { void hostWorkspaces.openPath(resolved.path).catch(error => console.error('side-panel host.openPath failed', error)) }),
    )
    openWith.onmouseenter = () => { submenu.hidden = false }; openWith.onmouseleave = () => { setTimeout(() => { if (!submenu.matches(':hover')) submenu.hidden = true }, 80) }; contextMenu.append(openWith, submenu)
    const sep = document.createElement('div'); sep.className = 'dfb-menu-sep'; contextMenu.append(sep)
    contextMenu.append(action('复制路径', () => { void navigator.clipboard.writeText(resolved.path) }))
    contextMenu.append(action('添加到任务', () => {
      const composer = conversationRoot?.querySelector<HTMLTextAreaElement>('textarea:not([aria-hidden="true"])'); if (composer === null || composer === undefined) return
      const start = composer.selectionStart; composer.setRangeText(entry.path, start, composer.selectionEnd, 'end'); composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: entry.path })); composer.focus()
    }))
  }
  const dismissMenus = (event: PointerEvent): void => {
    const target = event.target as Node
    if (!contextMenu.contains(target)) hideMenu()
    if (!addMenu.contains(target) && target !== addTab) addMenu.hidden = true
  }
  document.addEventListener('pointerdown', dismissMenus)

  let browserTab: HTMLButtonElement | null = null
  let browserTabLabel: HTMLSpanElement | null = null
  let browserTabStage: HTMLSpanElement | null = null
  const featureLabels = ['文件', '终端', '审查'] as const
  let featureLabelIndex = 0
  let featureLabelTimer: number | undefined
  let featureAnimationTimers: number[] = []
  let featureLabelAnimating = false
  let featureFlight: HTMLElement | null = null
  let browserTabWhale: HTMLElement | null = null
  const removeFeatureFlight = (): void => {
    if (featureFlight === null) return
    const whale = featureFlight.querySelector<HTMLElement>('.dfb-tab-whale')
    if (whale !== null) removeFishLogo(whale)
    featureFlight.remove()
    featureFlight = null
  }
  const launchWhale = (): void => {
    const tab = browserTab
    if (tab === null) return
    removeFeatureFlight()
    const rect = tab.getBoundingClientRect()
    const flight = document.createElement('div'); flight.className = 'dfb-whale-flight'; flight.style.left = `${rect.left + rect.width / 2 - 40}px`; flight.style.top = `${rect.top - 50}px`
    const whale = createFishLogo(); whale.classList.add('dfb-tab-whale')
    const splash = document.createElement('span'); splash.className = 'dfb-tab-splash'; splash.append(document.createElement('i'), document.createElement('b'))
    flight.append(whale, splash); document.body.append(flight); featureFlight = flight
  }
  const showFeatureLabel = (index: number, animate: boolean): void => {
    featureLabelIndex = index
    const label = browserTabLabel
    if (label === null) return
    if (!animate || featureLabelAnimating) { label.textContent = featureLabels[index]; return }
    featureLabelAnimating = true
    launchWhale()
    label.dataset.motion = 'out'
    featureAnimationTimers.push(window.setTimeout(() => {
      label.textContent = featureLabels[index]
      label.dataset.motion = 'in'
      featureAnimationTimers.push(window.setTimeout(() => { delete label.dataset.motion }, 270))
    }, 520))
    featureAnimationTimers.push(window.setTimeout(() => { removeFeatureFlight(); featureLabelAnimating = false; featureAnimationTimers = [] }, 1_120))
  }
  const stopFeatureLabels = (reset: boolean): void => {
    if (featureLabelTimer !== undefined) window.clearTimeout(featureLabelTimer)
    featureLabelTimer = undefined
    for (const timer of featureAnimationTimers) window.clearTimeout(timer)
    featureAnimationTimers = []
    featureLabelAnimating = false
    removeFeatureFlight()
    if (reset) showFeatureLabel(0, false)
    if (browserTabLabel !== null) delete browserTabLabel.dataset.motion
  }
  scheduleFeatureLabel = (kind: PanelKind): void => {
    if (featureLabelTimer !== undefined) window.clearTimeout(featureLabelTimer)
    featureLabelTimer = undefined
    const target = kind === 'files' ? 0 : kind === 'terminal' ? 1 : 2
    if (root.hidden || target === featureLabelIndex) return
    featureLabelTimer = window.setTimeout(() => { featureLabelTimer = undefined; if (!root.hidden && activeKind === kind) showFeatureLabel(target, true) }, 5_000)
  }
  const mountTab = (): void => {
    const tablists = document.querySelectorAll<HTMLElement>('[role="tablist"]')
    const tablist = [...tablists].find(candidate =>
      [...candidate.querySelectorAll<HTMLButtonElement>(':scope > button[role="tab"]')]
        .some(tab => {
          const label = tab.textContent?.trim()
          return label === 'Trajectory' || label === '轨迹'
        }),
    )
    if (tablist === undefined) return
    const header = tablist.closest('header')
    const candidate = header?.parentElement
    if (header instanceof HTMLElement && candidate instanceof HTMLElement) attachConversation(candidate, header)
    if (tablist.querySelector('.dfb-tab') !== null) return
    const reference = tablist.querySelector<HTMLButtonElement>(':scope > button[role="tab"][aria-selected="false"]')
      ?? tablist.querySelector<HTMLButtonElement>(':scope > button[role="tab"]')
    if (reference === null) return
    const tab = document.createElement('button')
    tab.type = 'button'; tab.role = 'tab'; tab.className = `${reference.className} dfb-tab`
    const stage = document.createElement('span'); stage.className = 'dfb-tab-stage'
    const label = document.createElement('span'); label.className = 'dfb-tab-label'; label.textContent = featureLabels[featureLabelIndex]
    const whale = createFishLogo(); whale.classList.add('dfb-tab-whale'); stage.append(whale); browserTabWhale = whale
    const splash = document.createElement('span'); splash.className = 'dfb-tab-splash'; splash.append(document.createElement('i'), document.createElement('b'))
    stage.append(label, splash); tab.append(stage); browserTabLabel = label; browserTabStage = stage
    tab.setAttribute('aria-selected', String(!root.hidden))
    tab.onclick = () => { root.hidden ? open() : closePanel() }
    tablist.append(tab); browserTab = tab
  }
  const tabObserver = new MutationObserver(mountTab)
  tabObserver.observe(document.body, { childList: true, subtree: true })
  mountTab()

  let loadedSession = ''
  const clientSessions = (ctx as unknown as {
    sessions: {
      list: { getSnapshot(): { current?: string; byId: Record<string, { id: string; parentId?: string; displayTitle: string; running?: boolean }> } }
      open(id: string): void
    }
  }).sessions
  const currentSession = (): string | undefined => clientSessions.list.getSnapshot().current
  let reviewMode: ReviewMode = 'unstaged'
  let reviewRequest = 0
  const refreshReview = async (): Promise<void> => {
    const sessionId = currentSession(); if (sessionId === undefined) return
    const request = ++reviewRequest
    if (review.childElementCount === 0) review.textContent = '正在读取 Git 变更…'
    const response = await postApi({ sessionId, action: 'review', mode: reviewMode })
    if (request !== reviewRequest) return
    if (response.ok && 'review' in response) renderReview(
      review,
      response.review,
      nextMode => { reviewMode = nextMode; void refreshReview() },
      (action, path) => { void postApi({ sessionId, action, path }).then(result => { if (result.ok) void refreshReview(); else review.textContent = result.error }) },
    )
    else review.textContent = response.ok ? '无数据' : response.error
  }
  let terminalId: string | undefined
  let xterm: XTerminal | undefined
  let terminalPoll: number | undefined
  const terminalTheme = (): { background: string; foreground: string; selectionBackground: string; selectionInactiveBackground: string } => {
    const computed = getComputedStyle(root)
    return {
      background: computed.getPropertyValue('--dfb-bg').trim() || '#fff',
      foreground: computed.getPropertyValue('--dfb-text').trim() || '#171719',
      selectionBackground: computed.getPropertyValue('--dsw-alias-state-business-tertiary').trim() || '#c9dcff',
      selectionInactiveBackground: computed.getPropertyValue('--dsw-alias-state-business-tertiary').trim() || '#c9dcff',
    }
  }
  let dfbLastDark = document.body.hasAttribute('data-ds-dark-theme')
  const themeObserver = new MutationObserver(() => {
    if (xterm !== undefined) xterm.options.theme = terminalTheme()
    refreshEditorThemes()
    const dark = document.body.hasAttribute('data-ds-dark-theme')
    if (dark !== dfbLastDark) {
      dfbLastDark = dark
      const browserRoot = document.getElementById('dsh-file-browser')
      if (browserRoot !== null) dfbRenderMermaidBlocks(browserRoot)
    }
  })
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
  const pollTerminal = async (): Promise<void> => {
    const sessionId = currentSession(); if (sessionId === undefined || terminalId === undefined) return
    const response = await postApi({ sessionId, action: 'terminal-read', terminalId })
    if (response.ok && 'pty' in response) { if (response.pty.output !== '') xterm?.write(response.pty.output); if (response.pty.exited && terminalPoll !== undefined) window.clearInterval(terminalPoll) }
  }
  const ensureTerminal = async (): Promise<void> => {
    if (terminalId !== undefined) { setTimeout(() => { xterm?.clearSelection(); fitTerminal() }, 0); return }
    const sessionId = currentSession(); if (sessionId === undefined) return
    xterm = new XTerminal({ cursorBlink: true, convertEol: true, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13, theme: terminalTheme() })
    const fit = new FitAddon(); fitAddon = fit; xterm.loadAddon(fit); xterm.open(terminal); fitTerminal(); requestAnimationFrame(fitTerminal)
    const response = await postApi({ sessionId, action: 'terminal-open', cols: xterm.cols, rows: xterm.rows })
    if (!response.ok || !('pty' in response)) { xterm.write(`\r\n${response.ok ? '无法启动终端' : response.error}\r\n`); return }
    terminalId = response.pty.id
    xterm.onData(data => { if (terminalId !== undefined) void postApi({ sessionId, action: 'terminal-input', terminalId, data }) })
    terminalPoll = window.setInterval(() => void pollTerminal(), 60)
    await pollTerminal()
  }
  let fitAddon: FitAddon | undefined
  let resizeFrame: number | undefined
  const fitTerminal = (): void => {
    if (terminal.hidden || xterm === undefined || fitAddon === undefined) return
    fitAddon.fit()
    const sessionId = currentSession()
    if (sessionId !== undefined && terminalId !== undefined) void postApi({ sessionId, action: 'terminal-resize', terminalId, cols: xterm.cols, rows: xterm.rows })
  }
  const terminalResizeObserver = new ResizeObserver(() => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => { resizeFrame = undefined; xterm?.clearSelection(); fitTerminal() })
  })
  terminalResizeObserver.observe(terminal)
  let expanded = false
  expand.onclick = () => { expanded = !expanded; panelWidth = expanded && conversationRoot !== null ? Math.floor(conversationRoot.clientWidth * 0.75) : defaultWidth; syncGrid(); expand.dataset.active = String(expanded) }
  const load = async (sessionId: string, path: string, target: HTMLElement): Promise<void> => {
    target.textContent = '加载中…'
    const result = await api(sessionId, 'list', path)
    if (!result.ok || !('entries' in result)) { target.textContent = result.ok ? '无数据' : result.error; return }
    target.replaceChildren()
    for (const entry of result.entries) {
      const row = button(entry.name, entry.kind === 'directory' ? '▸' : '')
      row.dataset.searchText = entry.name.toLocaleLowerCase()
      if (entry.kind === 'directory') {
        row.firstElementChild!.className = 'dfb-disclosure'
        row.insertBefore(fileIcon(entry.name, true), row.lastElementChild)
      } else {
        row.firstElementChild!.replaceWith(fileIcon(entry.name))
      }
      row.oncontextmenu = event => { event.preventDefault(); void openContextMenu(entry, event.clientX, event.clientY) }
      if (entry.kind === 'directory') {
        const children = document.createElement('div'); children.className = 'dfb-children'; children.hidden = true; children.dataset.expanded = 'false'
        let loaded = false
        row.onclick = () => {
          const expanded = children.dataset.expanded !== 'true'; children.dataset.expanded = String(expanded); children.hidden = !expanded; row.firstElementChild!.textContent = expanded ? '▾' : '▸'
          if (!loaded) { loaded = true; void load(sessionId, entry.path, children) }
        }
        target.append(row, children)
      } else {
        row.onclick = async () => {
          currentPath.textContent = entry.path
          tabButtons.get('files')!.firstElementChild!.textContent = entry.name; preview.innerHTML = '<div class="dfb-empty">正在读取…</div>'
          const response = await api(sessionId, 'preview', entry.path)
          if (!response.ok || !('preview' in response)) { renderPreviewMessage(preview, '无法预览文件', response.ok ? '服务端没有返回文件内容。' : response.error, '⚠'); return }
          renderPreview(preview, response.preview, async contentValue => { const saved = await postApi({ sessionId, action: 'write', path: entry.path, content: contentValue }); if (!saved.ok) throw new Error(saved.error) })
        }
        target.append(row)
      }
    }
  }
  refreshTree.onclick = () => { const sessionId = currentSession(); if (sessionId !== undefined) void load(sessionId, '', tree) }
  toggleTree.onclick = () => { body.dataset.tree = String(body.dataset.tree !== 'true') }
  const open = (): void => {
    const wasHidden = root.hidden
    root.hidden = false; browserTab?.setAttribute('aria-selected', 'true')
    if (wasHidden) scheduleFeatureLabel(activeKind)
    syncGrid()
    const sessionId = currentSession()
    if (sessionId === undefined) { tree.textContent = '当前没有打开的会话'; return }
    if (loadedSession !== sessionId) { loadedSession = sessionId; tabButtons.get('files')!.firstElementChild!.textContent = '文件'; preview.innerHTML = '<div class="dfb-empty">从文件树选择文件</div>'; void load(sessionId, '', tree) }
  }
  const openFile = async (path: string): Promise<void> => {
    open()
    const sessionId = currentSession()
    if (sessionId === undefined) return
    selectKind('files'); currentPath.textContent = path; tabButtons.get('files')!.firstElementChild!.textContent = path.split('/').at(-1) ?? path; preview.innerHTML = '<div class="dfb-empty">正在读取…</div>'
    const response = await api(sessionId, 'preview', path)
    if (!response.ok || !('preview' in response)) { renderPreviewMessage(preview, '无法预览文件', response.ok ? '服务端没有返回文件内容。' : response.error, '⚠'); return }
    renderPreview(preview, response.preview, async contentValue => { const saved = await postApi({ sessionId, action: 'write', path, content: contentValue }); if (!saved.ok) throw new Error(saved.error) })
  }
  const closePanel = (): void => {
    root.hidden = true; browserTab?.setAttribute('aria-selected', 'false')
    stopFeatureLabels(true)
    if (conversationRoot !== null) conversationRoot.style.gridTemplateColumns = 'minmax(0, 1fr) 0px'
  }
  close.onclick = closePanel
  const key = (event: KeyboardEvent): void => { if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'e') { event.preventDefault(); root.hidden ? open() : closePanel() } }
  window.addEventListener('keydown', key)
  return { root, openFile, dispose() { window.removeEventListener('keydown', key); document.removeEventListener('pointerdown', dismissMenus); stopFeatureLabels(true); if (searchTimer !== undefined) window.clearTimeout(searchTimer); if (terminalPoll !== undefined) window.clearInterval(terminalPoll); if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame); terminalResizeObserver.disconnect(); themeObserver.disconnect(); for (const [host, editor] of activeEditors) { if (root.contains(host)) { editor.view.destroy(); activeEditors.delete(host) } } const sessionId = currentSession(); if (sessionId !== undefined && terminalId !== undefined) void postApi({ sessionId, action: 'terminal-close', terminalId }); xterm?.dispose(); tabObserver.disconnect(); if (browserTabWhale !== null) removeFishLogo(browserTabWhale); browserTab?.remove(); contextMenu.remove(); addMenu.remove(); restoreConversationLayout(); root.remove(); style.remove() } }
}

export function apply(ctx: ClientContext): void {
  const panel = createPanel(ctx)
  const intercept = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest('button[class*="_fileLink"]') : null
    if (!(target instanceof HTMLButtonElement)) return
    const path = target.textContent?.trim()
    if (!path) return
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
    void panel.openFile(path)
  }
  document.addEventListener('click', intercept, true)
  ctx.effect(() => () => { document.removeEventListener('click', intercept, true); panel.dispose() }, 'file-browser: panel + file-link interception')
}
