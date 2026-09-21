import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { translateText } from '../src/translations';
/**
 * Chinese runs that may survive translation on purpose:
 * - i18n.ts only holds language names, and each mode sets its own label.
 * - looks.ts formats relative times itself and returns English directly when the view is English.
 * - the print package README is a bilingual text file, not rendered in the page.
 */
const SKIP_FILES = new Set(['i18n.ts']);
const SKIP_PIECES = ['打印包 / Print package'];
const ALLOWED_RUNS = new Set(['中文', '刚刚', '分钟前', '小时前', '天前', '保存', '配色']);
const CJK = /[一-鿿]/;
const CJK_RUNS = /[一-鿿]+/g;
const srcDir = new URL('../src/', import.meta.url);
/** Every literal segment a user can see: strings and the static parts of template literals. */
function segments(file: string) {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(file, srcDir), 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  );
  const found: string[] = [];
  const walk = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      found.push(node.text);
    ts.forEachChild(node, walk);
  };
  walk(source);
  return found;
}
describe('view language catalog', () => {
  it('translates every Chinese fragment it renders, so nothing reaches the page half-translated', () => {
    const gaps: string[] = [];
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.ts') && !SKIP_FILES.has(f))) {
      for (const segment of segments(file)) {
        if (SKIP_PIECES.some((skip) => segment.startsWith(skip))) continue;
        // Template holes split a sentence; translate whatever is left between them.
        for (const piece of segment.split(/\s*\$\{[^}]*\}\s*/)) {
          if (!CJK.test(piece)) continue;
          const leftover = (translateText(piece, 'en').match(CJK_RUNS) || []).filter(
            (run) => !ALLOWED_RUNS.has(run),
          );
          if (leftover.length) gaps.push(`${file}: ${leftover.join(' ')}`);
        }
      }
    }
    expect([...new Set(gaps)]).toEqual([]);
  });
  it('never rewrites IDs, hex colors or numbers', () => {
    for (const text of ['10-06-top_head_shell', '#F1EFE7', '256 × 256 mm', 'party', 'Pla'])
      expect(translateText(text, 'en')).toBe(text);
  });
  it('translates the longest phrase first so composed sentences stay readable', () => {
    expect(translateText('已套用「暖白与橙」', 'en')).toBe('Applied “Ivory & orange”');
    expect(translateText('我的耗材', 'en')).toBe('My filaments');
    expect(translateText('我的配色方案', 'en')).toBe('My color schemes');
    expect(translateText('共 3 个联动零件', 'en')).toBe('共 3 linked parts from your filaments');
  });
});
