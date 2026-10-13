import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

const MARKUP: [RegExp, string][] = [
  [/lovable-badge|edit with lovable|id="lovable-badge"/, 'Lovable badge'],
  [/built with bolt|bolt\.new badge/, 'Bolt badge'],
  [/replit-badge|made with replit/, 'Replit badge'],
  [/made in framer|framer badge|__framer-badge/, 'Framer badge'],
  [/made with webflow|w-webflow-badge/, 'Webflow badge'],
  [/\/@vite\/client|\/@react-refresh|__vite_plugin_react_preamble|vite\/client/, 'Vite dev client'],
  [/localhost:\d{4}|127\.0\.0\.1:\d{4}/, 'localhost URL'],
  [/__nuxt_devtools|react-devtools|__next_devtools/, 'devtools hook'],
  [/hot-update\.json|webpack-hmr|\bwebpackHotUpdate/, 'hot-reload residue'],
  [/content="vite-react-typescript-starter"|vite \+ react|vite-react-typescript-starter/, 'starter template title'],
];

const COPY: [RegExp, string][] = [
  [/lorem ipsum/, 'lorem ipsum'],
  [/your app name|your company name|company name here|your tagline here/, 'placeholder copy'],
  [/as an ai language model|i cannot browse|here'?s the updated code|i've updated the/, 'chat residue'],
  [/\btodo:|\bfixme\b|coming soon placeholder|insert text here/, 'TODO text'],
  [/welcome to your (new )?(app|project|site)|hello world/, 'starter copy'],
  [/```/, 'markdown code fence in visible text'],
];

export const check: CheckModule = {
  id: 'ai-leftovers',
  run(ctx) {
    const gate = needPage(ctx, this.id);
    if (gate) return gate;
    const page = ctx.page;
    if (!page) return result(this.id, 'error', 'page not parsed');
    const found: string[] = [];
    for (const [re, label] of MARKUP) if (re.test(page.markers)) found.push(label);
    for (const [re, label] of COPY) if (re.test(page.text)) found.push(label);
    const title = (page.title ?? '').toLowerCase();
    if (/^(vite|react|next|nuxt|astro) app$|^(my|new) app$|^document$|^untitled$|^lovable app$|^v0 app$|^create next app$/.test(title)) found.push(`default title "${page.title}"`);
    if (found.length) return result(this.id, 'fail', found.slice(0, 4).join(', '));
    return result(this.id, 'pass', 'no builder badges, dev-server hints, placeholder copy or chat residue');
  },
};
