# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/iAm-182/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/iAm-182/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for csv-reader 1.0.0: `solve.js` answers exactly as
csv-reader does on every case — same `{columns, rows, errors}`, same
broken-CSV policy (BOM drop, CRLF / lone-CR handling, quoted-field rules,
`quote_junk`, `unterminated_quote`, `stray_cr`, `short_row` / `long_row`
padding and cutting) — but several times faster.

## How it is fast

The reference builds every field a character at a time. This parser never
does: fields are slices of the input, found with native scans for the next
delimiter, and a field is only joined from pieces when it actually holds a
stray CR, a doubled quote, or a line break inside quotes (the rare cases).
On top of that, a record with no quote before its line break — no quoted
field, no embedded line break, no stray CR — is split in one native
`split(',')` call.

On the kit's practice set (6 cases, ~10.2 MB of CSV) the solver runs in
~0.10 s against the house baseline's ~0.5–0.7 s on this machine, with all
6 cases byte-identical to csv-reader's answers, and 20,000 randomised
edge-case inputs show zero mismatches against the reference.

## Run it

```sh
mkdir -p /tmp/out
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

Node 22.18+, standard library only, no dependencies, deterministic.

## Layout

- `solve.js` — the parser; `run(input)` returns `{columns, rows, errors}`.
- `main.ts` — the kit's driver: reads `/input/cases.json`, writes
  `/output/answers.json`.
- `package.json` — `{"type": "module"}` so `solve.js` loads as an ES module.

## License

MIT — see `LICENSE`.
