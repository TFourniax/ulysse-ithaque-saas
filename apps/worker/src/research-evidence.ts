import type { ResearchPage } from '@ulysse/domain';

/** References are scoped to this saved page, never interpreted as URLs or tool instructions. */
export function researchEvidence(page: ResearchPage) {
  const passages: { id: string; text: string }[] = [];
  let start = 0;
  while (start < page.text.length) {
    const window = page.text.slice(start, start + 700);
    let length = window.length;
    if (start + length < page.text.length) {
      const sentenceEnds = [...window.matchAll(/[.!?]\s/gu)];
      const last = sentenceEnds.at(-1)?.index;
      const space = window.lastIndexOf(' ');
      if (last !== undefined && last >= 250) length = last + 1;
      else if (space >= 250) length = space;
      else if (/^[\uD800-\uDBFF]$/u.test(window.at(-1) ?? '')) length--;
    }
    const text = page.text.slice(start, start + length).trim();
    const previous = passages.at(-1);
    if (text.length >= 12) passages.push({ id: `p${passages.length + 1}`, text });
    else if (text && previous) {
      // Preserve the exact substring, including the whitespace before a short final fragment.
      const previousStart = page.text.lastIndexOf(previous.text, start);
      const joined = page.text.slice(previousStart, start + length).trim();
      if (joined.length <= 1000) previous.text = joined;
    }
    start += length;
  }
  return {
    passages,
    links: page.links.slice(0, 80).map((link, index) => ({ id: `l${index + 1}`, ...link })),
  };
}
