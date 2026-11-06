# shared

Pure modules (no React, no DOM, no Node APIs) used by both the API (`server/`) and the storefront (`storefront/`): prices,
the delivery fee, locales, texts, URLs, stock rules, media helpers.

This folder exists **twice**, once in `server/shared` and once in `storefront/shared`, so that each app deploys on its own.
The two copies must stay identical. After changing a file, copy it to the other folder and run:

    node integration/check_shared_in_sync.mjs
