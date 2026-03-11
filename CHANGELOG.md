# Change Log

All notable changes to the bARGE Visual Studio Code extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [v1.7.0] - 2026-03-11
### New Features
- [`bce4eee`](https://github.com/PalmEmanuel/bARGE/commit/bce4eeece401c71e51033deb3bc30aac23cf0c7e) - Results can now be filtered directly like in Excel, with extra filtering options and sticky filters to persist between queries *(PR [#231](https://github.com/PalmEmanuel/bARGE/pull/231) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#216](https://github.com/PalmEmanuel/bARGE/issues/216) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*
- [`366c46d`](https://github.com/PalmEmanuel/bARGE/commit/366c46dd57ad638c553e47cf11fd67e7072cb93c) - Add auto-fit functionality for column resizing on double-click *(PR [#230](https://github.com/PalmEmanuel/bARGE/pull/230) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#228](https://github.com/PalmEmanuel/bARGE/issues/228) opened by [@gummigroda](https://github.com/gummigroda)*

### Bug Fixes
- [`4e62d26`](https://github.com/PalmEmanuel/bARGE/commit/4e62d26512fc0d760739f9d162e5ae2795e3aab9) - Resizing columns no longer unintentionally sorts them *(PR [#229](https://github.com/PalmEmanuel/bARGE/pull/229) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *fixes issue [#155](https://github.com/PalmEmanuel/bARGE/issues/155) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*


## [v1.6.0] - 2026-03-04
### New Features
- [`f3326ab`](https://github.com/PalmEmanuel/bARGE/commit/f3326abca3445331873b13358260c16e9e381f63) - Queries can now be run in new tabs to retain results *(PR [#221](https://github.com/PalmEmanuel/bARGE/pull/221) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#200](https://github.com/PalmEmanuel/bARGE/issues/200) opened by [@gummigroda](https://github.com/gummigroda)*
- [`a3291e5`](https://github.com/PalmEmanuel/bARGE/commit/a3291e56202dc074b95c2e08bb05404fd7849667) - Add CodeLens buttons to run queries directly from KQL blocks *(PR [#215](https://github.com/PalmEmanuel/bARGE/pull/215) by [@PalmEmanuel](https://github.com/PalmEmanuel))*


## [v1.5.0] - 2026-03-03
### New Features
- [`4bb502c`](https://github.com/PalmEmanuel/bARGE/commit/4bb502c291fb918881bb8b7285ff0f8639f8c2eb) - Adds support for more than 1000 records, added setting for API call paging size *(PR [#213](https://github.com/PalmEmanuel/bARGE/pull/213) by [@PalmEmanuel](https://github.com/PalmEmanuel))*


## [v1.4.0] - 2026-03-03
### New Features
- [`6f19400`](https://github.com/PalmEmanuel/bARGE/commit/6f1940099c65a9f7573b874ad4b60f90562691e8) - The header of the query results table is now frozen and follows scrolling *(PR [#201](https://github.com/PalmEmanuel/bARGE/pull/201) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#198](https://github.com/PalmEmanuel/bARGE/issues/198) opened by [@gummigroda](https://github.com/gummigroda)*


## [v1.3.0] - 2025-11-01
### New Features
- [`7ee5bae`](https://github.com/PalmEmanuel/bARGE/commit/7ee5bae20c17b3a52c7f1df3d3f6f7039f3aaaae) - Add implicit query selection based on cursor position *(PR [#178](https://github.com/PalmEmanuel/bARGE/pull/178) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#113](https://github.com/PalmEmanuel/bARGE/issues/113) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*
- [`0fb5d30`](https://github.com/PalmEmanuel/bARGE/commit/0fb5d302d17499d6e34077dab134c8d907284886) - Improved identification of potential identity guid columns *(PR [#177](https://github.com/PalmEmanuel/bARGE/pull/177) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#174](https://github.com/PalmEmanuel/bARGE/issues/174) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*
- [`1b63518`](https://github.com/PalmEmanuel/bARGE/commit/1b63518831d0bd41f6a1601d9078fec630cbbeea) - Improve subscription scope retrieval time, remove package dependency for subscriptions *(PR [#175](https://github.com/PalmEmanuel/bARGE/pull/175) by [@PalmEmanuel](https://github.com/PalmEmanuel))*


## [v1.2.2] - 2025-10-26
### Bug Fixes
- [`1cfdb51`](https://github.com/PalmEmanuel/bARGE/commit/1cfdb51f0be4d8a07308dec82f17bc905dcf34cd) - **panel**: Ensure details button column remains correctly sized for all result table sizes *(PR [#161](https://github.com/PalmEmanuel/bARGE/pull/161) by [@PalmEmanuel](https://github.com/PalmEmanuel))*


## [v1.2.1] - 2025-10-26
### Bug Fixes
- [`184d728`](https://github.com/PalmEmanuel/bARGE/commit/184d7280553e567b0f32ec7340f95f3a5c162b8c) - Improved column sizing of results table, allowing horizontal scrolling *(PR [#154](https://github.com/PalmEmanuel/bARGE/pull/154) by [@Copilot](https://github.com/apps/copilot-swe-agent))*
  - *fixes issue [#153](https://github.com/PalmEmanuel/bARGE/issues/153) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*


## [v1.2.0] - 2025-09-21
### New Features
- [`5ce0332`](https://github.com/PalmEmanuel/bARGE/commit/5ce03329d8a9d09959b6b1a3c1fa0be918befad6) - Add feature to resolve GUIDs in results as Entra ID identities *(PR [#123](https://github.com/PalmEmanuel/bARGE/pull/123) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#15](https://github.com/PalmEmanuel/bARGE/issues/15) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*
- [`76ee617`](https://github.com/PalmEmanuel/bARGE/commit/76ee61798d11743674fecff83a4be3d73f493e56) - **panel**: Query errors now have an option to display raw error data *(PR [#117](https://github.com/PalmEmanuel/bARGE/pull/117) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#88](https://github.com/PalmEmanuel/bARGE/issues/88) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*


## [v1.1.2] - 2025-09-16
### New Features
- [`7105c86`](https://github.com/PalmEmanuel/bARGE/commit/7105c868ee2db5bae6a653b202498c2aabd3d11a) - Add configuration setting to hide login messages *(PR [#110](https://github.com/PalmEmanuel/bARGE/pull/110) by [@Copilot](https://github.com/apps/copilot-swe-agent))*
  - *addresses issue [#89](https://github.com/PalmEmanuel/bARGE/issues/89) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*
- [`d0ebc4c`](https://github.com/PalmEmanuel/bARGE/commit/d0ebc4ce4f3cc6495ea1e5526d61539999eef215) - Add configuration settings to disable intellisense hover or completions *(PR [#111](https://github.com/PalmEmanuel/bARGE/pull/111) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#95](https://github.com/PalmEmanuel/bARGE/issues/95) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*


## [v1.1.1] - 2025-09-15
### Bug Fixes
- [`3d343ba`](https://github.com/PalmEmanuel/bARGE/commit/3d343baa41e5db66795201c4a648b909ec3f6209) - Update schema path to use the distribution folder *(PR [#108](https://github.com/PalmEmanuel/bARGE/pull/108) by [@PalmEmanuel](https://github.com/PalmEmanuel))*


## [v1.1.0] - 2025-09-15
### New Features
- [`5345188`](https://github.com/PalmEmanuel/bARGE/commit/5345188dfb9d4829b050a1322cce87a945274df0) - Add full syntax highlighting, intellisense with hover, completions and documentation of KQL *(PR [#98](https://github.com/PalmEmanuel/bARGE/pull/98) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#74](https://github.com/PalmEmanuel/bARGE/issues/74) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*
- [`9cb585d`](https://github.com/PalmEmanuel/bARGE/commit/9cb585d0d22afdb654c0aefbd2234e0875d25ada) - Added buttons to editor bar to run selected or file query commands *(PR [#97](https://github.com/PalmEmanuel/bARGE/pull/97) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#96](https://github.com/PalmEmanuel/bARGE/issues/96) opened by [@gummigroda](https://github.com/gummigroda)*

### Bug Fixes
- [`259f8a6`](https://github.com/PalmEmanuel/bARGE/commit/259f8a6c0796ebddac4a7f3777d52c08499aeb3f) - **panel**: Improved formatting for query execution date and time in results view *(PR [#83](https://github.com/PalmEmanuel/bARGE/pull/83) by [@Copilot](https://github.com/apps/copilot-swe-agent))*
  - *fixes issue [#75](https://github.com/PalmEmanuel/bARGE/issues/75) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*


## [v1.0.1] - 2025-09-09
### Bug Fixes
- [`345c700`](https://github.com/PalmEmanuel/bARGE/commit/345c7007b0e8e711701605a3d1d39e23c34dd040) - **panel**: Column order is now preserved from query and comparison view updates when re-ordering *(PR [#78](https://github.com/PalmEmanuel/bARGE/pull/78) by [@PalmEmanuel](https://github.com/PalmEmanuel))*

### Chores


## [v1.0.0] - 2025-09-08
### New Features
- [`24b0471`](https://github.com/PalmEmanuel/bARGE/commit/24b0471f8283eab1422cce862831338f7a4a8cf2) - **panel**: Improved loading animation with dark & light mode support *(PR [#70](https://github.com/PalmEmanuel/bARGE/pull/70) by [@PalmEmanuel](https://github.com/PalmEmanuel))*

### Bug Fixes
- [`797f7b3`](https://github.com/PalmEmanuel/bARGE/commit/797f7b334d8505e94206fdd4b4f491a58ddedd4f) - Right click menu now shows correct Copy options in details pane *(PR [#67](https://github.com/PalmEmanuel/bARGE/pull/67) by [@PalmEmanuel](https://github.com/PalmEmanuel))*

### Chores


## [v0.0.13] - 2025-09-07

### New Features
[48da006](https://github.com/PalmEmanuel/bARGE/commit/48da0066d11149487d26ea11b3a698ba5992e500) - Right click menu in details pane now has Copy option for properties, and Copy Compressed for JSON (PR [#50](https://github.com/PalmEmanuel/bARGE/pull/50) by [@Copilot](https://github.com/apps/copilot-swe-agent))
- *addresses issue [#49](https://github.com/PalmEmanuel/bARGE/issues/49) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*

### Bug Fixes
[339e4e5](https://github.com/PalmEmanuel/bARGE/commit/339e4e54f1f705419cc4382324095631b624e534) - Clarify changelog for Marketplace, improve version update process (PR [#58](https://github.com/PalmEmanuel/bARGE/pull/58) by [@PalmEmanuel](https://github.com/PalmEmanuel))

## [v0.0.12] - 2025-09-07

### BREAKING CHANGES

- due to [`573c40d`](https://github.com/PalmEmanuel/bARGE/commit/573c40dd2395c26e5ee28180bdcf2a943ae02892) - Adds build/test/release pipeline, Conventional Commits for CHANGELOG automation, v0.0.12, sets minimum supported VS Code version to 1.101.0 *(PR [#45](https://github.com/PalmEmanuel/bARGE/pull/45) by [@PalmEmanuel](https://github.com/PalmEmanuel))*:

  Minimum supported VS Code version increased to 1.101.0

### New Features

- [`69fb290`](https://github.com/PalmEmanuel/bARGE/commit/69fb290933ed51d86542d00fbba4eef90f791170) - Add support for right-clicking KQL files in VS Code Explorer to run query *(PR [#47](https://github.com/PalmEmanuel/bARGE/pull/47) by [@Copilot](https://github.com/apps/copilot-swe-agent))*
  - *addresses issue [#46](https://github.com/PalmEmanuel/bARGE/issues/46) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*
- [`573c40d`](https://github.com/PalmEmanuel/bARGE/commit/573c40dd2395c26e5ee28180bdcf2a943ae02892) - Adds build/test/release pipeline, Conventional Commits for CHANGELOG automation, v0.0.12, sets minimum supported VS Code version to 1.101.0 *(PR [#45](https://github.com/PalmEmanuel/bARGE/pull/45) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - *addresses issue [#39](https://github.com/PalmEmanuel/bARGE/issues/39) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*
  - *addresses issue [#40](https://github.com/PalmEmanuel/bARGE/issues/40) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*

## [v0.0.11] - 2025-09-04

### Added

- Added status bar indicator at the bottom of editor to show currently signed-in account and extension job status like running queries [#34](https://github.com/PalmEmanuel/bARGE/pull/34)

## [v0.0.10] - 2025-09-04

### Added

- Added sign-in account picker that shows available Microsoft accounts in VS Code alongside the [DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?wt.mc_id=DT-MVP-5005372) option [#31](https://github.com/PalmEmanuel/bARGE/pull/31)
- Added default keybinding `F5` for running a KQL query file [#31](https://github.com/PalmEmanuel/bARGE/pull/31)

### Changed

- Renamed commands in VS Code [#31](https://github.com/PalmEmanuel/bARGE/pull/31)
- Improved conditions for when VS Code commands are available [#31](https://github.com/PalmEmanuel/bARGE/pull/31)

### Fixes

- Arrow buttons enabled/disabled state is now correctly set when selecting all rows through magnifying glass [#27](https://github.com/PalmEmanuel/bARGE/pull/27)

### Removes

- Removes unused configuration options that may be partly re-implemented in better form later [#31](https://github.com/PalmEmanuel/bARGE/pull/31)

## [v0.0.9] - 2025-09-02

### Changed

- Improved error handling, selection logic and details pane navigation [#20](https://github.com/PalmEmanuel/bARGE/pull/20)
- Updated API version used for querying Azure Resource Graph [#20](https://github.com/PalmEmanuel/bARGE/pull/20)

## [v0.0.8] - 2025-09-02

### Changed

- Changed name of bARGE extension from `basic Azure Resource Graph Explorer` to `boosted Azure Resource Graph Explorer` [#18](https://github.com/PalmEmanuel/bARGE/pull/18)

## [v0.0.7] - 2025-09-02

### Added

- Added comparison functionality in details pane when selecting more than one row [#17](https://github.com/PalmEmanuel/bARGE/pull/17)

### Changed

- Improved styling, navigation and selection in table and details pane [#16](https://github.com/PalmEmanuel/bARGE/pull/16) [#17](https://github.com/PalmEmanuel/bARGE/pull/17)
- Upgraded dependency package versions [#12](https://github.com/PalmEmanuel/bARGE/pull/12)

## [v0.0.6] - 2025-09-01

### Added

- Added details view pane to select a row and inspect properties, with arrows navigation [#10](https://github.com/PalmEmanuel/bARGE/pull/10)

### Removed

- Removed Azure Resource Graph package dependency to instead use REST API [#10](https://github.com/PalmEmanuel/bARGE/pull/10)

## [v0.0.5] - 2025-09-01

### Changed

- Reduced VS Code version requirements of extension for compatibility [#5](https://github.com/PalmEmanuel/bARGE/pull/5)

## [v0.0.4] - 2025-09-01

### Changed

- Improved selection logic and right click menu behavior [#3](https://github.com/PalmEmanuel/bARGE/pull/3)

## [v0.0.3] - 2025-08-31

### Changed

- Improved resolution of logo image [#1](https://github.com/PalmEmanuel/bARGE/pull/1)

## [v0.0.2] - 2025-08-31

### Added

- Added `F8` default keybinding to running selected text as query in KQL files.

### Changed

- Adjusted background of logo image.

## [v0.0.1] - 2025-08-30

Initial release of bARGE, supporting basic functionality for logging in using [DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?view=azure-node-latest&wt.mc_id=DT-MVP-5005372), running queries and displaying results in a table.
[v1.0.0]: https://github.com/PalmEmanuel/bARGE/compare/v0.0.13...v1.0.0
[v1.0.1]: https://github.com/PalmEmanuel/bARGE/compare/v1.0.0...v1.0.1
[v1.1.0]: https://github.com/PalmEmanuel/bARGE/compare/v1.0.1...v1.1.0
[v1.1.1]: https://github.com/PalmEmanuel/bARGE/compare/v1.1.0...v1.1.1
[v1.1.2]: https://github.com/PalmEmanuel/bARGE/compare/v1.1.1...v1.1.2
[v1.2.0]: https://github.com/PalmEmanuel/bARGE/compare/v1.1.2...v1.2.0
[v1.2.1]: https://github.com/PalmEmanuel/bARGE/compare/v1.2.0...v1.2.1
[v1.2.2]: https://github.com/PalmEmanuel/bARGE/compare/v1.2.1...v1.2.2
[v1.3.0]: https://github.com/PalmEmanuel/bARGE/compare/v1.2.2...v1.3.0
[v1.4.0]: https://github.com/PalmEmanuel/bARGE/compare/v1.3.0...v1.4.0
[v1.5.0]: https://github.com/PalmEmanuel/bARGE/compare/v1.4.0...v1.5.0
[v1.6.0]: https://github.com/PalmEmanuel/bARGE/compare/v1.5.0...v1.6.0
[v1.7.0]: https://github.com/PalmEmanuel/bARGE/compare/v1.6.0...v1.7.0
