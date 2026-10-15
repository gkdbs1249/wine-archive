# Vendored browser dependencies

Executable browser dependencies are stored locally so the deployed app does not execute mutable third-party CDN code at runtime.

- `browser-deps/supabase-2.117.3.min.js`: `@supabase/supabase-js` 2.117.3 UMD browser build.
- `browser-deps/tesseract-5.1.1.min.js`: `tesseract.js` 5.1.1 browser build.
- `browser-deps/tesseract-worker-5.1.1.min.js`: Tesseract.js 5.1.1 worker.
- `tesseract-core/`: `tesseract.js-core` 5.1.1 runtime variants.
- `tesseract-lang/eng.traineddata.gz`: English OCR data from the Tesseract.js Project Naptha 4.0.0 data endpoint.

`browser-deps/CHECKSUMS.sha256` pins every file in these directories. The test suite verifies the manifest before deployment.
