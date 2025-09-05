# Change Log

All notable changes to the bARGE Visual Studio Code extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]



## v0.0.11

### Added

- Added status bar indicator at the bottom of editor to show currently signed-in account and extension job status like running queries [#34](https://github.com/PalmEmanuel/bARGE/pull/34)

## v0.0.10

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

## v0.0.9

### Changed

- Improved error handling, selection logic and details pane navigation [#20](https://github.com/PalmEmanuel/bARGE/pull/20)
- Updated API version used for querying Azure Resource Graph [#20](https://github.com/PalmEmanuel/bARGE/pull/20)

## v0.0.8

### Changed

- Changed name of bARGE extension from `basic Azure Resource Graph Explorer` to `boosted Azure Resource Graph Explorer` [#18](https://github.com/PalmEmanuel/bARGE/pull/18)

## v0.0.7

### Added

- Added comparison functionality in details pane when selecting more than one row [#17](https://github.com/PalmEmanuel/bARGE/pull/17)

### Changed

- Improved styling, navigation and selection in table and details pane [#16](https://github.com/PalmEmanuel/bARGE/pull/16) [#17](https://github.com/PalmEmanuel/bARGE/pull/17)
- Upgraded dependency package versions [#12](https://github.com/PalmEmanuel/bARGE/pull/12)

## v0.0.6

### Added

- Added details view pane to select a row and inspect properties, with arrows navigation [#10](https://github.com/PalmEmanuel/bARGE/pull/10)

### Removed

- Removed Azure Resource Graph package dependency to instead use REST API [#10](https://github.com/PalmEmanuel/bARGE/pull/10)

## v0.0.5

### Changed

- Reduced VS Code version requirements of extension for compatibility [#5](https://github.com/PalmEmanuel/bARGE/pull/5)

## v0.0.4

### Changed

- Improved selection logic and right click menu behavior [#3](https://github.com/PalmEmanuel/bARGE/pull/3)

## v0.0.3

### Changed

- Improved resolution of logo image [#1](https://github.com/PalmEmanuel/bARGE/pull/1)

## v0.0.2

### Added

- Added `F8` default keybinding to running selected text as query in KQL files.

### Changed

- Adjusted background of logo image.

## v0.0.1

Initial release of bARGE, supporting basic functionality for logging in using [DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?view=azure-node-latest), running queries and displaying results in a table.
