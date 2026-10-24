import { writeFileSync } from 'node:fs';
import * as colors from '@radix-ui/colors';

const palettes = ['sage', 'grass', 'red', 'amber', 'blue', 'blackA', 'whiteA'];
const name = key => `--radix-${key.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/(\D)(\d)/g, '$1-$2').toLowerCase()}`;
const block = (selector, dark) => `${selector} {\n${palettes.flatMap(palette => Object.entries(colors[dark && !palette.endsWith('A') ? `${palette}Dark` : palette]).map(([key,value]) => `  ${name(key)}: ${value};`)).join('\n')}\n}\n`;
writeFileSync(new URL('../src/ui/radix-tokens.css', import.meta.url), `/* Generated from @radix-ui/colors 3.0.0. MIT, Copyright (c) 2021 Radix.\n   Regenerate: node ui/tools/generate-colors.mjs. Scope: classic UI only. */\n${block(".fluid-workspace[data-ui-version='old'], html[data-ui-version='old']", false)}${block("html.theme-dark .fluid-workspace[data-ui-version='old'], html.theme-dark[data-ui-version='old']", true)}`);
