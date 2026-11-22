# Academic Paper Download

How to search, verify, and download academic papers through `my-agent-browser`. Covers CNKI (知网), Google Scholar, MDPI, and other academic sources.

## Decision Tree

```
Start: Need to get a paper
  │
  ├─ Chinese paper? → CNKI workflow (below)
  ├─ MDPI/open access? → Direct PDF download (below)
  ├─ English journal paper? → Google Scholar → look for [PDF] link
  │     └─ No free PDF? → Mark as "verified, paywalled"
  └─ Book/monograph? → No PDF available, just verify it exists
```

## CNKI (知网)

### Removing non-gating DOM overlay widgets

When CNKI injects a non-gating overlay modal that merely blocks clicks without gating search results, remove the blocking overlay in DOM (if backend verification actually gates results and returns empty data for known titles, stop and ask the user to complete verification in a headed window):

```bash
my-agent-browser eval 1 "() => { document.querySelectorAll('[class*=\"modal-mask\"], [class*=\"overlay\"]').forEach(el => el.remove()); return 'cleaned'; }" --raw
```

### Search mode matters

CNKI defaults to "主题" (topic) fuzzy search, which often fails on multi-phrase titles.
Switch to **"篇名"** (title) search for exact matching, and search only the main title before `"——"`.

### Identifying the right paper & verifying downloads

1. Match by **author name** first, then **journal name** and **year**.
2. After clicking "下载", wait ~3 seconds and check `~/Downloads/`:
   - **> 100 KB**: valid CAJ or PDF.
   - **< 10 KB**: likely an HTML error page — check institutional login header (e.g. university library name vs `"个人登录"`).

## MDPI (Open Access)

URL pattern: `https://www.mdpi.com/{ISSN}/{volume}/{issue}/{article_number}`

```bash
my-agent-browser open "https://www.mdpi.com/2071-1050/..." --owner paper-dl
my-agent-browser eval 2 "() => document.querySelector('a[href*=\"/pdf\"]')?.href ?? null" --raw
# Navigate to that PDF URL to trigger browser download with session cookies
```

## Google Scholar & Inline PDFs

Search exact titles in quotes and look for `[PDF]` links on the right side. When a PDF renders inline instead of downloading, trigger download with:

```bash
my-agent-browser eval 2 "() => { const a = document.createElement('a'); a.href = window.location.href; a.download = 'paper.pdf'; document.body.appendChild(a); a.click(); a.remove(); return 'triggered'; }" --raw
```

## Verifying References Against Hallucination

Check in order:
1. Exact title findable on CNKI or Google Scholar.
2. Author list matches (not merely famous researchers in the same field).
3. Journal name, year, volume, issue, and page range match publication records.
4. DOI resolves to the same paper.
