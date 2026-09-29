# Third-party notices

npm dependencies are licence-checked in CI (`scripts/ci/check-licences.ts`, exceptions in
`.github/licence-exceptions.json`). Files committed to the repository from other projects are listed here.

## IBM Plex (SIL Open Font License 1.1)

- Files: `apps/web/src/fonts/*.woff2` (Plex Sans 400, 400 italic, 500, 600; Plex Sans Condensed 600; Plex Mono 400, 500; Latin-1 subsets).
- Source: official releases at https://github.com/IBM/plex (`@ibm/plex-sans@1.1.0`, `@ibm/plex-sans-condensed@2.0.0`, `@ibm/plex-mono@2.5.0`), fetched by `scripts/fonts/fetch-plex.sh`.
- Copyright (c) 2017 IBM Corp. with Reserved Font Name "Plex".
- Licence text: `apps/web/src/fonts/OFL.txt`, verbatim from the release. The fonts are self-hosted and unmodified.
