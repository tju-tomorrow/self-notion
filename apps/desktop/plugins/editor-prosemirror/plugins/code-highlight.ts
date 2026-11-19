/**
 * 代码块的语法高亮：只往文本上挂 `hl-*` decoration，不碰正文 DOM。
 * 这里只回答「这是哪一类词」；具体颜色由 `code-theme` 插件按 `<html data-code-theme>` 给。
 */
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { asString } from '../nodes/attrs'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('css', css)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('python', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)

/** 选语言时存的是我们自己的名字，进 highlighter 前换成它认识的。 */
const ALIAS: Readonly<Record<string, string>> = {
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  html: 'xml',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rs: 'rust',
  md: 'markdown',
  yml: 'yaml',
  plaintext: '',
  text: '',
  mermaid: '',
}

/** highlight.js 的类名 → 我们主题里那一档。表外的（subst 之类）就继承外层。 */
const KINDS: Readonly<Record<string, string>> = {
  comment: 'com',
  quote: 'com',
  keyword: 'kw',
  doctag: 'kw',
  'template-tag': 'kw',
  literal: 'lit',
  symbol: 'lit',
  built_in: 'builtin',
  'builtin-name': 'builtin',
  type: 'type',
  class: 'type',
  string: 'str',
  regexp: 'str',
  char: 'str',
  'template-string': 'str',
  'meta-string': 'str',
  number: 'num',
  title: 'fn',
  function: 'fn',
  section: 'fn',
  name: 'fn',
  'selector-class': 'fn',
  attr: 'attr',
  attribute: 'attr',
  property: 'attr',
  'selector-attr': 'attr',
  variable: 'var',
  params: 'var',
  'template-variable': 'var',
  'selector-id': 'var',
  tag: 'tag',
  meta: 'meta',
  'meta-keyword': 'meta',
  'meta-prompt': 'meta',
  operator: 'op',
  punctuation: 'op',
  addition: 'add',
  deletion: 'del',
}

interface Span {
  from: number
  to: number
  kind: string
}

const CACHE_MAX = 400
const cache = new Map<string, Span[]>()
const docCache = new WeakMap<PMNode, DecorationSet>()

function languageId(language: string): string {
  const key = language.trim().toLowerCase()
  if (key === '') return ''
  const mapped = ALIAS[key]
  if (mapped !== undefined) return mapped
  return hljs.getLanguage(key) ? key : ''
}

/** highlight.js 返回的是转义过的 HTML；用 `<template>` 拆开只为拿每段文字的范围。 */
function parse(html: string): Span[] {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const out: Span[] = []
  let pos = 0

  const kindOf = (el: Element, inherited: string): string => {
    let kind = inherited
    for (const cls of el.classList) {
      if (!cls.startsWith('hljs-')) continue
      const name = cls.slice(5)
      const mapped = KINDS[name] ?? (name.startsWith('char') ? 'str' : undefined)
      if (mapped) kind = mapped
    }
    return kind
  }

  const walk = (node: Node, kind: string): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).data.length
      if (len > 0 && kind) out.push({ from: pos, to: pos + len, kind })
      pos += len
      return
    }
    if (!(node instanceof Element)) return
    const next = kindOf(node, kind)
    for (const child of node.childNodes) walk(child, next)
  }

  for (const child of tpl.content.childNodes) walk(child, '')
  return out
}

function spansOf(language: string, text: string): Span[] {
  const id = languageId(language)
  if (id === '' || text.length > 100_000) return []
  const key = id + '\u0000' + text
  const hit = cache.get(key)
  if (hit) return hit
  let spans: Span[]
  try {
    spans = parse(hljs.highlight(text, { language: id, ignoreIllegals: true }).value)
  } catch {
    spans = []
  }
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, spans)
  return spans
}

function decorationsFor(doc: PMNode): DecorationSet {
  const hit = docCache.get(doc)
  if (hit) return hit
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    const text = node.textContent
    if (text) {
      const base = pos + 1
      for (const span of spansOf(asString(node.attrs.language), text)) {
        decos.push(Decoration.inline(base + span.from, base + span.to, { class: `hl-${span.kind}` }))
      }
    }
    return false
  })
  const set = DecorationSet.create(doc, decos)
  docCache.set(doc, set)
  return set
}

export const codeHighlightPlugin = new Plugin({
  key: new PluginKey('code-highlight'),
  props: {
    decorations: (state) => decorationsFor(state.doc),
  },
})
