// Every row, a page at a time. PostgREST returns at most max_rows (1000 on
// this project) per request and says nothing when it stops there, so a pull
// that doesn't page silently loses everything past the first thousand.
// Pure; see selfcheck.js.

/** Fetch pages until a short one says it was the last. */
export async function pageAll<T>(fetchPage: (from: number, to: number) => Promise<T[]>, size = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const page = await fetchPage(from, from + size - 1);
    rows.push(...page);
    if (page.length < size) return rows;
  }
}
