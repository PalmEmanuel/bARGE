# Test Coverage for bARGE Extension

This document outlines the comprehensive test suite added to validate the functionality requirements specified in issue #29.

## Test Files Added

### 1. `src/test/extension.test.ts` (Enhanced)
**Core Azure Service and BargePanel Tests**

#### AzureService Tests
- **Table Creation with Mock Data**: Tests `convertObjectArrayToTable()` method with realistic Azure Resource Graph data including storage accounts, VMs, and various resource types
- **Data Structure Validation**: Verifies correct column creation, row data integrity, and null handling for missing properties
- **Edge Case Handling**: Tests empty arrays, null/undefined inputs

#### BargePanel Error Handling Tests  
- **HTTP Status Code Error Mapping**: Tests error message formatting for 400, 401, 403, 404, 429, and 500 errors
- **Custom Error Details**: Validates proper handling of Azure error response structures
- **Error Response Structure**: Ensures QueryResponse objects are properly formatted for failures

#### Query Response Processing Tests
- **Successful Query Processing**: Tests column name cleaning (removing parenthetical parts) and response structure
- **Empty Result Handling**: Validates behavior with no data returned
- **Data Integrity**: Verifies row and column data preservation through processing

#### Data Comparison Logic Tests
- **Row Comparison Setup**: Tests preparation of data for comparison views
- **Property Difference Detection**: Validates identification of differing values between rows
- **Multi-row Comparison**: Tests handling of multiple selected rows for comparison

### 2. `src/test/webview.test.ts` (New)
**Webview Interaction and Selection Logic Tests**

#### Row Selection Logic
- **Single Row Selection**: Tests circle click behavior for individual row selection
- **Multi-Row Selection**: Validates Ctrl+click behavior for multiple row selection
- **Select All/None**: Tests magnifying glass header click for selecting all rows or clearing selection
- **Selection State Management**: Verifies proper tracking of selected row indices

#### Details Pane Logic
- **Single Row Details**: Tests title generation ("Row X of Y") for single selection
- **Comparison View**: Tests title generation ("Comparing X rows") for multiple selection
- **Pane Visibility**: Tests logic for when details pane should open/close

#### Navigation Logic
- **Forward/Backward Navigation**: Tests row navigation with wrap-around behavior
- **Boundary Handling**: Validates navigation from first/last rows
- **Index Management**: Tests proper index updating during navigation

#### Table State Management
- **Sort Persistence**: Tests maintaining selection after table sorting
- **Row Identity Tracking**: Validates finding selected rows in reordered data
- **Selection Mapping**: Tests proper index remapping after data changes

#### Circle Button State Logic
- **Button Visual States**: Tests active/inactive states for row detail buttons
- **Fill State Management**: Validates filled vs outlined circle appearance
- **Header State**: Tests magnifying glass state changes for comparison mode

### 3. `src/test/errorHandling.test.ts` (New)
**Error Display and Query Validation Tests**

#### Error Message Display Logic
- **HTML Structure Generation**: Tests proper error HTML structure creation
- **Multi-Section Errors**: Validates handling of complex error responses with multiple detail sections
- **Error Formatting**: Tests key-value pair formatting in error details
- **Missing Details Handling**: Tests error display when no details are available

#### Query Validation Logic
- **Valid KQL Patterns**: Tests recognition of proper KQL query syntax
- **Invalid Query Detection**: Tests identification of empty queries, comments, and common typos
- **Query Preprocessing**: Validates query trimming and basic validation

#### Azure Error Response Processing
- **Complex Error Parsing**: Tests parsing of Azure error responses with nested details
- **Status Code Handling**: Validates extraction of meaningful messages from HTTP errors
- **Error Detail Structuring**: Tests proper formatting of error details for display

#### Error UI State Management
- **State Transitions**: Tests UI state changes between error and success states
- **Component Visibility**: Validates showing/hiding of table, export button, and error displays
- **State Reset**: Tests proper cleanup of error state on successful queries

## Test Coverage Summary

### Requirements Validation

✅ **Use mock data to verify that a table is created**
- `AzureService.convertObjectArrayToTable()` tests with realistic Azure resource data
- Column and row structure validation
- Data type and null handling verification

✅ **Verify that details pane pops up on circle click, and that table selection is correct on navigation and multiselect**
- Row selection logic tests for single and multi-selection
- Details pane visibility and title generation tests
- Navigation logic with proper index management
- Circle button state management tests

✅ **Verify comparison of property values of two rows in mocking data**
- Data comparison logic tests with difference detection
- Multi-row comparison setup and property value comparison
- Comparison view title generation

✅ **Verify selection is correct when selecting all and no rows by selecting from circles and magnifying glass**
- Select all/none functionality tests
- Magnifying glass header state management
- Circle button state synchronization
- Selection state persistence after table operations

✅ **Verify that an error message is displayed correctly on faulty query**
- Comprehensive error handling tests for all HTTP status codes
- Error message formatting and display structure
- Azure error response parsing and detail extraction
- UI state management during error conditions

## Running the Tests

```bash
# Compile tests
npm run compile-tests

# Run full test preparation
npm run pretest

# Note: Full test execution requires VS Code environment
# Tests validate core logic that can be unit tested outside of VS Code webview context
```

## Test Philosophy

These tests focus on the core business logic and data processing functionality that can be effectively unit tested outside of the VS Code webview environment. While the full UI interactions require the VS Code Extension Host, these tests validate:

1. **Data Processing Logic**: Core algorithms for table creation, data transformation, and comparison
2. **Error Handling Logic**: Comprehensive error processing and formatting
3. **Selection Logic**: State management and navigation algorithms
4. **Query Processing**: Response handling and validation logic

This approach ensures robust testing of the critical functionality while maintaining the minimal change requirement and working within the constraints of the existing VS Code extension test infrastructure.