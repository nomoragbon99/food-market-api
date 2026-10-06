/**
 * WCAG contrast ratios for every text/background pair on /consumer, in both
 * colour schemes. AA requires 4.5:1 for normal text and 3:1 for large text
 * (>=18.66px bold or >=24px). Run: node evidence/contrast-check.mjs
 */
const srgb = (channel) => {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const n = hex.replace("#", "");
  const full = n.length === 3 ? [...n].map((c) => c + c).join("") : n;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}

function ratio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const LIGHT = {
  text: "#1a1a1a",
  textMuted: "#555555",
  surface: "#ffffff",
  surfaceSunken: "#ffffff",
  buttonBg: "#1a1a1a",
  buttonText: "#ffffff",
  open: "#116655",
  closed: "#aa1111",
  errorText: "#7a1b1b",
  errorBg: "#fdf5f5",
};

const DARK = {
  text: "#f2f2f2",
  textMuted: "#b8b8b8",
  surface: "#0a0a0a",
  surfaceSunken: "#151515",
  buttonBg: "#f2f2f2",
  buttonText: "#111111",
  open: "#5fd3b2",
  closed: "#ff9a9a",
  errorText: "#ffb4b4",
  errorBg: "#2a1515",
};

const pairs = (t) => [
  ["page title / page background", t.text, t.surface, 3],
  ["restaurant name / card", t.text, t.surfaceSunken, 4.5],
  ["body text / page background", t.text, t.surface, 4.5],
  ["muted meta / card", t.textMuted, t.surfaceSunken, 4.5],
  ["muted meta / page background", t.textMuted, t.surface, 4.5],
  ["input text / input background", t.text, t.surface, 4.5],
  ["button label / button", t.buttonText, t.buttonBg, 4.5],
  ['"Open" badge / card', t.open, t.surfaceSunken, 4.5],
  ['"Closed" badge / card', t.closed, t.surfaceSunken, 4.5],
  ["error text / error panel", t.errorText, t.errorBg, 4.5],
];

let failures = 0;
for (const [scheme, tokens] of [["LIGHT", LIGHT], ["DARK", DARK]]) {
  console.log(`\n${scheme} scheme`);
  for (const [label, fg, bg, required] of pairs(tokens)) {
    const value = ratio(fg, bg);
    const pass = value >= required;
    if (!pass) failures += 1;
    console.log(
      `  [${pass ? "PASS" : "FAIL"}] ${label.padEnd(34)} ${fg} on ${bg}  ${value.toFixed(2)}:1 (needs ${required}:1)`,
    );
  }
}

console.log(`\n${failures === 0 ? "All pairs meet WCAG AA." : `${failures} pair(s) below AA.`}`);
process.exitCode = failures === 0 ? 0 : 1;
