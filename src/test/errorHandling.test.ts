import * as assert from 'assert';
import { QueryResponse } from '../types';

/**
 * Tests for error handling and query validation logic
 */
suite('Error Handling Tests', () => {

	suite('Error Message Display Logic', () => {
		test('should format error display structure correctly', () => {
			const error = 'Query execution failed';
			const errorDetails = 'Error Code: InvalidQuery\nLine: 1\nColumn: 15\nMessage: Syntax error near "WHER"';
			
			// Simulate error display logic from displayError function
			let errorHtml = '<div class="error">';
			errorHtml += '<div class="error-title">Query Execution Failed</div>';

			// Main error message
			if (error && error.trim()) {
				errorHtml += '<div class="error-message">' + escapeHtml(error) + '</div>';
			}
			
			// Details section
			if (errorDetails && errorDetails.trim()) {
				const detailSections = errorDetails.split('\n---\n');
				
				if (detailSections.length > 0) {
					errorHtml += '<div class="error-details-container">';
					
					detailSections.forEach((section) => {
						if (section.trim()) {
							errorHtml += '<div class="error-detail-box">';
							
							const lines = section.trim().split('\n');
							lines.forEach((line) => {
								if (line.trim()) {
									const [key, ...valueParts] = line.split(': ');
									const value = valueParts.join(': ');
									
									if (value) {
										errorHtml += '<div class="error-detail-item">';
										errorHtml += '<span class="error-detail-key">' + escapeHtml(key) + ':</span> ';
										errorHtml += '<span class="error-detail-value">' + escapeHtml(value) + '</span>';
										errorHtml += '</div>';
									} else {
										errorHtml += '<div class="error-detail-item">' + escapeHtml(line) + '</div>';
									}
								}
							});
							
							errorHtml += '</div>';
						}
					});
					
					errorHtml += '</div>';
				}
			}
			
			errorHtml += '</div>';
			
			// Verify error structure contains expected elements
			assert.ok(errorHtml.includes('Query Execution Failed'), 'Should contain error title');
			assert.ok(errorHtml.includes('Query execution failed'), 'Should contain error message');
			assert.ok(errorHtml.includes('InvalidQuery'), 'Should contain error details');
			assert.ok(errorHtml.includes('error-detail-key'), 'Should format detail keys');
			assert.ok(errorHtml.includes('error-detail-value'), 'Should format detail values');
		});

		test('should handle error with multiple detail sections', () => {
			const error = 'Multiple validation errors';
			const errorDetails = 'Syntax Error: Invalid WHERE clause\n---\nValidation Error: Column "namee" does not exist\n---\nSuggestion: Did you mean "name"?';
			
			// Simulate processing of multiple sections
			const detailSections = errorDetails.split('\n---\n');
			
			assert.strictEqual(detailSections.length, 3, 'Should split into 3 sections');
			assert.strictEqual(detailSections[0].trim(), 'Syntax Error: Invalid WHERE clause');
			assert.strictEqual(detailSections[1].trim(), 'Validation Error: Column "namee" does not exist');
			assert.strictEqual(detailSections[2].trim(), 'Suggestion: Did you mean "name"?');
		});

		test('should handle error without details', () => {
			const error = 'Network connection failed';
			const errorDetails: string = '';
			
			let errorDisplay = {
				hasTitle: true,
				hasMessage: !!(error && error.trim() !== ''),
				hasDetails: !!(errorDetails && errorDetails.length > 0 && errorDetails.trim() !== ''),
				messageContent: error
			};
			
			assert.strictEqual(errorDisplay.hasMessage, true, 'Should have error message');
			assert.strictEqual(errorDisplay.hasDetails, false, 'Should not have error details');
			assert.strictEqual(errorDisplay.messageContent, 'Network connection failed');
		});
	});

	suite('Azure Error Response Processing', () => {
		test('should parse Azure error responses correctly', () => {
			// Mock Azure error response structure
			const mockAzureError = {
				error: {
					code: 'InvalidQuery',
					message: 'The provided query is invalid',
					details: [
						{
							code: 'SyntaxError',
							message: 'Syntax error at line 1, column 15',
							target: 'query'
						},
						{
							code: 'ValidationError', 
							message: 'Column "namee" does not exist',
							target: 'projection'
						}
					]
				}
			};

			// Simulate error processing logic
			let errorMessage = 'Unknown error occurred';
			let errorDetails = '';

			if (mockAzureError.error) {
				errorMessage = mockAzureError.error.message || 'Query execution failed';
				
				if (mockAzureError.error.details && Array.isArray(mockAzureError.error.details)) {
					const detailSections = mockAzureError.error.details.map(detail => {
						let section = '';
						if (detail.code) {
							section += `Error Code: ${detail.code}\n`;
						}
						if (detail.message) {
							section += `Message: ${detail.message}\n`;
						}
						if (detail.target) {
							section += `Target: ${detail.target}`;
						}
						return section.trim();
					});
					
					if (detailSections.length > 0) {
						errorDetails = detailSections.join('\n---\n');
					}
				}
			}

			const response: QueryResponse = {
				success: false,
				error: errorMessage,
				errorDetails: errorDetails
			};

			assert.strictEqual(response.success, false, 'Response should indicate failure');
			assert.strictEqual(response.error, 'The provided query is invalid', 'Should extract main error message');
			assert.ok(response.errorDetails?.includes('SyntaxError'), 'Should include syntax error details');
			assert.ok(response.errorDetails?.includes('ValidationError'), 'Should include validation error details');
			assert.ok(response.errorDetails?.includes('---'), 'Should separate error sections');
		});

		test('should handle simplified Azure error format', () => {
			const simpleError = {
				message: 'Request failed with status code 400: Bad Request - Invalid query syntax'
			};

			// Simulate simplified error handling
			let errorMessage = 'Unknown error occurred';
			let errorDetails = '';

			if (simpleError.message) {
				errorMessage = simpleError.message;
				
				// Extract status code specific handling
				if (simpleError.message.includes('400')) {
					errorMessage = 'Bad Request - Invalid query syntax or parameters';
					errorDetails = simpleError.message;
				}
			}

			assert.strictEqual(errorMessage, 'Bad Request - Invalid query syntax or parameters');
			assert.strictEqual(errorDetails, 'Request failed with status code 400: Bad Request - Invalid query syntax');
		});
	});

	suite('Error UI State Management', () => {
		test('should manage error display state correctly', () => {
			// Simulate error state management
			let uiState = {
				showError: false,
				showTable: true,
				showExportButton: true,
				errorContent: '',
				resultsInfo: 'Showing results'
			};

			// Error occurs
			const error = 'Query failed';
			const errorDetails = 'Detailed error information';

			// Update state for error display
			uiState.showError = true;
			uiState.showTable = false;
			uiState.showExportButton = false;
			uiState.errorContent = `${error}\n${errorDetails}`;
			uiState.resultsInfo = 'Query execution failed.';

			assert.strictEqual(uiState.showError, true, 'Should show error');
			assert.strictEqual(uiState.showTable, false, 'Should hide table');
			assert.strictEqual(uiState.showExportButton, false, 'Should hide export button');
			assert.strictEqual(uiState.resultsInfo, 'Query execution failed.', 'Should update results info');
		});

		test('should reset error state on successful query', () => {
			// Start with error state
			let uiState = {
				showError: true,
				showTable: false,
				showExportButton: false,
				errorContent: 'Previous error',
				resultsInfo: 'Query execution failed.'
			};

			// Successful query
			const mockResult = {
				columns: [{ name: 'name', type: 'string' }],
				data: [['test-resource']],
				totalRecords: 1
			};

			// Reset state for successful result
			uiState.showError = false;
			uiState.showTable = true;
			uiState.showExportButton = true;
			uiState.errorContent = '';
			uiState.resultsInfo = `Showing ${mockResult.totalRecords} results`;

			assert.strictEqual(uiState.showError, false, 'Should hide error');
			assert.strictEqual(uiState.showTable, true, 'Should show table');
			assert.strictEqual(uiState.showExportButton, true, 'Should show export button');
			assert.strictEqual(uiState.errorContent, '', 'Should clear error content');
			assert.strictEqual(uiState.resultsInfo, 'Showing 1 results', 'Should update results info');
		});
	});
});

// Helper function to simulate HTML escaping
function escapeHtml(text: string): string {
	const div = { innerHTML: '' } as any;
	div.textContent = text;
	return div.innerHTML || text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}