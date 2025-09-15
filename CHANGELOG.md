# Change Log

All notable changes to the bARGE Visual Studio Code extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [v1.1.0] - 2025-09-15
### New Features
- [`9d27895`](https://github.com/PalmEmanuel/bARGE/commit/9d27895ac7f287d43df018f905e9b5312919333e) - Add documentation links for join operator kinds in hover and completion items *(PR [#100](https://github.com/PalmEmanuel/bARGE/pull/100) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
- [`5345188`](https://github.com/PalmEmanuel/bARGE/commit/5345188dfb9d4829b050a1322cce87a945274df0) - Add full syntax highlighting, intellisense with hover, completions and documentation of KQL *(PR [#98](https://github.com/PalmEmanuel/bARGE/pull/98) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - :arrow_lower_right: *addresses issue [#74](https://github.com/PalmEmanuel/bARGE/issues/74) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*
- [`9cb585d`](https://github.com/PalmEmanuel/bARGE/commit/9cb585d0d22afdb654c0aefbd2234e0875d25ada) - Added buttons to editor bar to run selected or file query commands *(PR [#97](https://github.com/PalmEmanuel/bARGE/pull/97) by [@PalmEmanuel](https://github.com/PalmEmanuel))*
  - :arrow_lower_right: *addresses issue [#96](https://github.com/PalmEmanuel/bARGE/issues/96) opened by [@gummigroda](https://github.com/gummigroda)*

### Bug Fixes
- [`259f8a6`](https://github.com/PalmEmanuel/bARGE/commit/259f8a6c0796ebddac4a7f3777d52c08499aeb3f) - **panel**: Improved formatting for query execution date and time in results view *(PR [#83](https://github.com/PalmEmanuel/bARGE/pull/83) by [@Copilot](https://github.com/apps/copilot-swe-agent))*
  - :arrow_lower_right: *fixes issue [#75](https://github.com/PalmEmanuel/bARGE/issues/75) opened by [@PalmEmanuel](https://github.com/PalmEmanuel)*


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

- Added sign-in account picker that shows available Microsoft accounts in VS Code alongside the [DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?view=azure-node-latest) option [#31](https://github.com/PalmEmanuel/bARGE/pull/31)
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

Initial release of bARGE, supporting basic functionality for logging in using [DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?view=azure-node-latest), running queries and displaying results in a table.
[v1.0.0]: https://github.com/PalmEmanuel/bARGE/compare/v0.0.13...v1.0.0
[v1.0.1]: https://github.com/PalmEmanuel/bARGE/compare/v1.0.0...v1.0.1
[v1.1.0]: https://github.com/PalmEmanuel/bARGE/compare/v1.0.1...v1.1.0
