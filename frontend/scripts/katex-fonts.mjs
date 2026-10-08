// All supported WebViews support WOFF2. Keep every KaTeX face, but avoid
// embedding the same font in three encodings. This also covers exported CSS.
export function woff2OnlyKaTeX(css) {
  // Minified @font-face rules may omit the final semicolon. Never consume the
  // closing brace and the following .katex font rule while trimming sources.
  return css.replace(/src:\s*([^;}]+)(;?)/g, (declaration, sources, terminator) => {
    const woff2 = sources.match(/url\([^)]*\.woff2\)\s*format\(["']woff2["']\)/);
    return woff2 ? `src: ${woff2[0]}${terminator}` : declaration;
  });
}
