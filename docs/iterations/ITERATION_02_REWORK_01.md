# Iteration 02 — Rework 01

**Status:** READY  
**Parent iteration:** `ITERATION_02_PLANNING_ENGINE.md`  
**Baseline commit under review:** `eeffeec8a956552fc86c5b455f0d62b9de552086`

## Audit finding

The Excel contract says unknown extra columns are ignored.

Current `parse_xlsx()` registers every normalized header in `header_positions` and raises `DUPLICATE_COLUMN` when any header repeats. This also rejects workbooks that contain duplicate **unknown extra** columns, although those columns should be ignored by the MVP contract.

Example that must remain valid:

```text
задача | описание | исполнитель | длительность | предшественники | note | note
```

The duplicate `note` columns are outside the supported contract and must not make the import invalid.

## Required correction

- Ignore unknown extra columns completely for structural validation.
- Continue rejecting a duplicated required column, because the required field mapping would be ambiguous.
- Do not change the five-column input contract or any other Iteration 02 behavior.

## Tests

Add regression coverage proving that:

1. required columns + duplicated unknown extra columns import successfully;
2. a duplicated required column still returns `DUPLICATE_COLUMN`;
3. the full backend suite remains green;
4. frontend lint and production build remain green.

## Completion

- Make only this focused correction and necessary tests.
- Do not begin Iteration 03.
- Create one rework commit.
- Return the commit hash, test results, changed files, and any blocker/deviation.
