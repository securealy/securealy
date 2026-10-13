import { parseDocument, DomUtils } from 'htmlparser2';

type Document = ReturnType<typeof parseDocument>;
type Element = ReturnType<typeof DomUtils.findAll>[number];

export interface ScriptRef {
  src: string | null;
  type: string | null;
  async: boolean;
  defer: boolean;
  module: boolean;
  inHead: boolean;
  inline: string;
}

export interface LinkRef {
  rel: string;
  href: string;
  as: string | null;
  inHead: boolean;
  media: string | null;
}

export interface ImageRef {
  src: string;
  srcset: string | null;
  loading: string | null;
}

export interface AnchorRef {
  href: string;
  text: string;
}

/** A serializable, check-friendly view of the home page. */
export interface ParsedPage {
  title: string | null;
  lang: string | null;
  metas: { name: string; content: string }[];
  links: LinkRef[];
  scripts: ScriptRef[];
  images: ImageRef[];
  anchors: AnchorRef[];
  iframes: string[];
  forms: { action: string | null; method: string | null }[];
  h1Count: number;
  jsonLd: string[];
  /** lower-cased visible text, capped */
  text: string;
  /** all inline script text joined, capped */
  inlineScript: string;
  /** the raw html lower-cased, capped, for marker searches */
  markers: string;
}

const TEXT_CAP = 60_000;
const INLINE_CAP = 1_000_000;
const MARKER_CAP = 1_500_000;

function attr(el: Element, name: string): string | null {
  const v = el.attribs[name];
  return typeof v === 'string' ? v : null;
}

function isInHead(el: Element): boolean {
  let p = el.parent;
  while (p) {
    if (p.type === 'tag' && (p as Element).name === 'head') return true;
    p = p.parent;
  }
  return false;
}

export function parsePage(html: string): ParsedPage {
  const doc: Document = parseDocument(html, { lowerCaseAttributeNames: true, lowerCaseTags: true });
  const all = DomUtils.findAll(() => true, doc.children) as Element[];
  const out: ParsedPage = {
    title: null,
    lang: null,
    metas: [],
    links: [],
    scripts: [],
    images: [],
    anchors: [],
    iframes: [],
    forms: [],
    h1Count: 0,
    jsonLd: [],
    text: '',
    inlineScript: '',
    markers: html.slice(0, MARKER_CAP).toLowerCase(),
  };
  const inline: string[] = [];
  let inlineBytes = 0;
  for (const el of all) {
    switch (el.name) {
      case 'html':
        out.lang = attr(el, 'lang');
        break;
      case 'title':
        if (out.title === null) out.title = DomUtils.textContent(el).trim();
        break;
      case 'meta': {
        const name = attr(el, 'name') ?? attr(el, 'property') ?? attr(el, 'http-equiv');
        const content = attr(el, 'content');
        if (name && content !== null) out.metas.push({ name: name.toLowerCase(), content });
        break;
      }
      case 'link': {
        const rel = attr(el, 'rel');
        const href = attr(el, 'href');
        if (rel && href) out.links.push({ rel: rel.toLowerCase(), href, as: attr(el, 'as'), inHead: isInHead(el), media: attr(el, 'media') });
        break;
      }
      case 'script': {
        const type = attr(el, 'type');
        const src = attr(el, 'src');
        const text = src ? '' : DomUtils.textContent(el);
        if (type && type.toLowerCase().includes('ld+json')) {
          out.jsonLd.push(text);
        } else if (!src && inlineBytes < INLINE_CAP) {
          inline.push(text);
          inlineBytes += text.length;
        }
        out.scripts.push({
          src,
          type,
          async: el.attribs['async'] !== undefined,
          defer: el.attribs['defer'] !== undefined,
          module: (type ?? '').toLowerCase() === 'module',
          inHead: isInHead(el),
          inline: src ? '' : text.slice(0, 2000),
        });
        break;
      }
      case 'img': {
        const src = attr(el, 'src') ?? attr(el, 'data-src');
        if (src) out.images.push({ src, srcset: attr(el, 'srcset'), loading: attr(el, 'loading') });
        break;
      }
      case 'a': {
        const href = attr(el, 'href');
        if (href) out.anchors.push({ href, text: DomUtils.textContent(el).trim().slice(0, 80) });
        break;
      }
      case 'iframe': {
        const src = attr(el, 'src');
        if (src) out.iframes.push(src);
        break;
      }
      case 'form':
        out.forms.push({ action: attr(el, 'action'), method: attr(el, 'method') });
        break;
      case 'h1':
        out.h1Count += 1;
        break;
    }
  }
  out.inlineScript = inline.join('\n').slice(0, INLINE_CAP);
  const body = DomUtils.findOne((e) => e.name === 'body', doc.children) ?? null;
  const textSource = body ?? doc;
  const text = DomUtils.textContent(textSource as Element).replace(/\s+/g, ' ').trim();
  out.text = text.slice(0, TEXT_CAP).toLowerCase();
  return out;
}

export function meta(page: ParsedPage, name: string): string | null {
  const m = page.metas.find((x) => x.name === name.toLowerCase());
  return m ? m.content : null;
}

export function resolveUrl(base: string, href: string): string | null {
  try {
    const h = href.trim();
    if (!h || h.startsWith('#') || /^(javascript|mailto|tel|data|blob):/i.test(h)) return null;
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function sameSite(url: string, host: string, apex: string): boolean {
  const h = hostOf(url);
  if (!h) return false;
  return h === host || h === apex || h.endsWith(`.${apex}`);
}
