import { ParseError, type StatementPages } from './types';

export interface TextItem {
  str: string;
  x: number;
  y: number;
}

/**
 * Group positioned text items into lines (top to bottom, left to right).
 * Items whose baselines are within `tolerance` points are on the same line.
 */
export function itemsToLines(items: TextItem[], tolerance = 3): string[] {
  const sorted = items
    .filter((i) => i.str.trim() !== '')
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; items: TextItem[] }[] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - item.y) <= tolerance) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows.map((r) =>
    r.items
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/** Extract text lines from every page of a PDF, entirely in the browser. */
export async function pdfToPages(data: ArrayBuffer): Promise<StatementPages> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'PasswordException') {
      throw new ParseError('This PDF is password-protected. Remove the password and try again.');
    }
    await task.destroy();
    throw new ParseError("This file couldn't be opened as a PDF. It may be damaged or not a PDF.");
  }

  try {
    const pages: StatementPages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const it of content.items) {
        if ('str' in it) items.push({ str: it.str, x: it.transform[4], y: it.transform[5] });
      }
      pages.push(itemsToLines(items));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
