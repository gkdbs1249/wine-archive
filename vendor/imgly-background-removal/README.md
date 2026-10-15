# Vendored background removal runtime

This directory contains pinned, self-hosted browser assets used by Wine Archive's bottle cutout feature.

- `@imgly/background-removal`: 1.7.0
- `onnxruntime-web`: 1.21.0
- Model: `isnet_quint8`
- Runtime device: CPU/WASM
- Source packages: npm/jsDelivr distributions for the exact versions above
- Model/WASM data: IMG.LY `@imgly/background-removal-data` 1.7.0

Only the CPU runtime resources and `isnet_quint8` model chunks referenced by `data/resources.json` are included. Runtime code and model assets are served from this repository rather than executed from a third-party CDN.

Licensing information is preserved in `LICENSE.md` and `ThirdPartyLicenses.json`. File hashes are recorded in `CHECKSUMS.sha256`.
