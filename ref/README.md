# ref/

Reference material for the project: anything we add that explains the data or the domain, rather than code.

| File | What it is |
|---|---|
| [Genie.md](Genie.md) | Source spec for the Genie agent (instructions, joins, snippets, examples, benchmarks); written for `sbx_petrinex_app`, adapted in `../genie/spec.py`. |
| [sbx_prompts.txt](sbx_prompts.txt) | Original brief, the Genie-generated "perfect prompt" notes and the Genie text instructions. |
| [perfect-prompt.md](perfect-prompt.md) | **The build spec.** CNRL deal-history baseline, step-by-step prompt, and the agreed executive decisions. Wins over the plan where they differ. |
| [acquisition-app-plan.md](acquisition-app-plan.md) | Plan for the CNRL acquisition app: method (ROCE / NPV@15%, proximity, transport savings), data pipeline, Lakebase + Dash app design, build order, open decisions. |
| [eda-report.html](eda-report.html) | EDA of `shm_hack.petrinex`: table catalog, production trends, operators, emissions, shut-ins, prices, join coverage, data-quality traps. Open it in a browser; it is self-contained. |

Put new reference data here, such as code lookups, Petrinex/AER docs, price files and notes, and add a row above for each one.
Query-writing rules for Claude live in [../.claude/data/](../.claude/data/).
