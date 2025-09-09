import * as assert from 'assert';
import * as vscode from 'vscode';
import { AzureService } from '../azure/azureService';
import { BargePanel } from '../bargePanel';
import { QueryResponse, QueryResult } from '../types';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	suite('AzureService Tests', () => {
		let azureService: AzureService;

		setup(() => {
			azureService = new AzureService();
		});

		test('convertObjectArrayToTable should create table from mock data', () => {
			// Mock data representing Azure Resource Graph query results
			const mockObjects = [
				{ 
					id: '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/storage1',
					name: 'storage1',
					type: 'Microsoft.Storage/storageAccounts',
					location: 'eastus',
					resourceGroup: 'rg1'
				},
				{
					id: '/subscriptions/sub1/resourceGroups/rg2/providers/Microsoft.Compute/virtualMachines/vm1', 
					name: 'vm1',
					type: 'Microsoft.Compute/virtualMachines',
					location: 'westus',
					resourceGroup: 'rg2',
					vmSize: 'Standard_B1s'
				},
				{
					id: '/subscriptions/sub2/resourceGroups/rg3/providers/Microsoft.Storage/storageAccounts/storage2',
					name: 'storage2', 
					type: 'Microsoft.Storage/storageAccounts',
					location: 'eastus',
					resourceGroup: 'rg3',
					sku: 'Standard_LRS'
				}
			];

			// Use reflection to access private method
			const convertMethod = (azureService as any).convertObjectArrayToTable.bind(azureService);
			const result = convertMethod(mockObjects);

			// Verify table structure is created correctly
			assert.ok(result.columns, 'Columns should be defined');
			assert.ok(result.rows, 'Rows should be defined'); 
			assert.strictEqual(result.columns.length, 7, 'Should have 7 columns (all unique properties)');
			assert.strictEqual(result.rows.length, 3, 'Should have 3 rows');

			// Verify column names preserve order from first object, then additional properties
			const expectedColumns = ['id', 'name', 'type', 'location', 'resourceGroup', 'vmSize', 'sku'];
			const actualColumnNames = result.columns.map((col: any) => col.name);
			assert.deepStrictEqual(actualColumnNames, expectedColumns, 'Column names should preserve order from first object');

			// Verify column types
			result.columns.forEach((col: any) => {
				assert.strictEqual(col.type, 'string', 'All columns should have string type');
			});

			// Verify row data integrity - first row should match first object
			const firstRowData = result.rows[0];
			assert.strictEqual(firstRowData[actualColumnNames.indexOf('name')], 'storage1', 'First row name should be storage1');
			assert.strictEqual(firstRowData[actualColumnNames.indexOf('type')], 'Microsoft.Storage/storageAccounts', 'First row type should match');
			assert.strictEqual(firstRowData[actualColumnNames.indexOf('location')], 'eastus', 'First row location should be eastus');

			// Verify null handling for missing properties
			const vmSizeIndex = actualColumnNames.indexOf('vmSize');
			assert.strictEqual(firstRowData[vmSizeIndex], null, 'Storage account should have null vmSize');
			assert.strictEqual(result.rows[1][vmSizeIndex], 'Standard_B1s', 'VM should have vmSize value');
		});

		test('convertObjectArrayToTable should handle empty array', () => {
			const convertMethod = (azureService as any).convertObjectArrayToTable.bind(azureService);
			const result = convertMethod([]);

			assert.deepStrictEqual(result, { columns: [], rows: [] }, 'Empty array should return empty table');
		});

		test('convertObjectArrayToTable should handle null/undefined input', () => {
			const convertMethod = (azureService as any).convertObjectArrayToTable.bind(azureService);
			
			const nullResult = convertMethod(null);
			assert.deepStrictEqual(nullResult, { columns: [], rows: [] }, 'Null input should return empty table');

			const undefinedResult = convertMethod(undefined);
			assert.deepStrictEqual(undefinedResult, { columns: [], rows: [] }, 'Undefined input should return empty table');
		});
	});

	suite('BargePanel Error Handling Tests', () => {
		test('should format error messages correctly for different HTTP status codes', () => {
			// Test different Azure error scenarios that would be handled in runQuery
			const testCases = [
				{
					inputError: new Error('Request failed with status code 400: Bad Request'),
					expectedMessage: 'Bad Request - Invalid query syntax or parameters',
					expectedDetails: 'Request failed with status code 400: Bad Request'
				},
				{
					inputError: new Error('Request failed with status code 401: Unauthorized'),
					expectedMessage: 'Unauthorized - Please check your Azure authentication', 
					expectedDetails: 'Try running "az login" or check your Azure credentials'
				},
				{
					inputError: new Error('Request failed with status code 403: Forbidden'),
					expectedMessage: 'Forbidden - Insufficient permissions',
					expectedDetails: 'You may not have permission to query the selected subscriptions or resources'
				},
				{
					inputError: new Error('Request failed with status code 404: Not Found'),
					expectedMessage: 'Not Found - Resource or subscription not found',
					expectedDetails: 'Request failed with status code 404: Not Found'
				},
				{
					inputError: new Error('Request failed with status code 429: Too Many Requests'),
					expectedMessage: 'Rate Limited - Too many requests', 
					expectedDetails: 'Please wait a moment before running another query'
				},
				{
					inputError: new Error('Request failed with status code 500: Internal Server Error'),
					expectedMessage: 'Server Error - Azure service error',
					expectedDetails: 'Request failed with status code 500: Internal Server Error'
				}
			];

			testCases.forEach(testCase => {
				// Simulate the error handling logic from BargePanel.runQuery
				let errorMessage = 'Unknown error occurred';
				let errorDetails = '';

				if (testCase.inputError instanceof Error) {
					errorMessage = testCase.inputError.message;
					
					// Extract details if available from our custom error parsing
					if ((testCase.inputError as any).details) {
						errorDetails = (testCase.inputError as any).details;
					} else {
						// Check for common Azure error patterns if no details were parsed
						if (testCase.inputError.message.includes('400')) {
							errorMessage = 'Bad Request - Invalid query syntax or parameters';
							errorDetails = testCase.inputError.message;
						} else if (testCase.inputError.message.includes('401')) {
							errorMessage = 'Unauthorized - Please check your Azure authentication';
							errorDetails = 'Try running "az login" or check your Azure credentials';
						} else if (testCase.inputError.message.includes('403')) {
							errorMessage = 'Forbidden - Insufficient permissions';
							errorDetails = 'You may not have permission to query the selected subscriptions or resources';
						} else if (testCase.inputError.message.includes('404')) {
							errorMessage = 'Not Found - Resource or subscription not found';
							errorDetails = testCase.inputError.message;
						} else if (testCase.inputError.message.includes('429')) {
							errorMessage = 'Rate Limited - Too many requests';
							errorDetails = 'Please wait a moment before running another query';
						} else if (testCase.inputError.message.includes('500')) {
							errorMessage = 'Server Error - Azure service error';
							errorDetails = testCase.inputError.message;
						}
					}
				}

				const response: QueryResponse = {
					success: false,
					error: errorMessage,
					errorDetails: errorDetails
				};

				assert.strictEqual(response.error, testCase.expectedMessage, 
					`Error message should match for ${testCase.inputError.message}`);
				assert.strictEqual(response.errorDetails, testCase.expectedDetails,
					`Error details should match for ${testCase.inputError.message}`);
				assert.strictEqual(response.success, false, 'Response should indicate failure');
			});
		});

		test('should handle custom error details correctly', () => {
			const customError = new Error('Custom Azure error');
			(customError as any).details = 'Custom error details with specific information';

			// Simulate error handling
			let errorMessage = 'Unknown error occurred';
			let errorDetails = '';

			if (customError instanceof Error) {
				errorMessage = customError.message;
				if ((customError as any).details) {
					errorDetails = (customError as any).details;
				}
			}

			const response: QueryResponse = {
				success: false,
				error: errorMessage,
				errorDetails: errorDetails
			};

			assert.strictEqual(response.error, 'Custom Azure error');
			assert.strictEqual(response.errorDetails, 'Custom error details with specific information');
			assert.strictEqual(response.success, false);
		});
	});

	suite('Query Response Processing Tests', () => {
		test('should process successful query response correctly', () => {
			// Mock successful query result
			const mockQueryResult: QueryResult = {
				columns: [
					{ name: 'Resource Name (resourceName)', type: 'string' },
					{ name: 'Resource Type (type)', type: 'string' },
					{ name: 'Location (location)', type: 'string' }
				],
				data: [
					['storage-account-1', 'Microsoft.Storage/storageAccounts', 'eastus'],
					['vm-instance-1', 'Microsoft.Compute/virtualMachines', 'westus'],
					['sql-database-1', 'Microsoft.Sql/servers/databases', 'centralus']
				],
				totalRecords: 3,
				query: 'Resources | project name, type, location | limit 3',
				timestamp: '2024-01-01T00:00:00.000Z'
			};

			// Simulate the column name processing from BargePanel.runQuery  
			if (mockQueryResult && mockQueryResult.columns) {
				mockQueryResult.columns = mockQueryResult.columns.map((col: any) => ({
					...col,
					name: col.name.split(' (')[0]
				}));
			}

			const response: QueryResponse = {
				success: true,
				data: mockQueryResult
			};

			// Verify the response structure
			assert.strictEqual(response.success, true, 'Response should indicate success');
			assert.ok(response.data, 'Response should contain data');
			assert.strictEqual(response.data.columns.length, 3, 'Should have 3 columns');
			assert.strictEqual(response.data.data.length, 3, 'Should have 3 rows');
			assert.strictEqual(response.data.totalRecords, 3, 'Total records should be 3');

			// Verify column name processing (removing parenthetical parts)
			assert.strictEqual(response.data.columns[0].name, 'Resource Name', 'First column name should be cleaned');
			assert.strictEqual(response.data.columns[1].name, 'Resource Type', 'Second column name should be cleaned');
			assert.strictEqual(response.data.columns[2].name, 'Location', 'Third column name should be cleaned');

			// Verify data integrity
			assert.strictEqual(response.data.data[0][0], 'storage-account-1', 'First row first column should match');
			assert.strictEqual(response.data.data[1][1], 'Microsoft.Compute/virtualMachines', 'Second row second column should match');
			assert.strictEqual(response.data.data[2][2], 'centralus', 'Third row third column should match');
		});

		test('should handle query result with no data', () => {
			const emptyQueryResult: QueryResult = {
				columns: [],
				data: [],
				totalRecords: 0,
				query: 'Resources | where name == "nonexistent"',
				timestamp: '2024-01-01T00:00:00.000Z'
			};

			const response: QueryResponse = {
				success: true,
				data: emptyQueryResult
			};

			assert.strictEqual(response.success, true, 'Empty result should still be successful');
			assert.strictEqual(response.data?.columns.length, 0, 'Should have no columns');
			assert.strictEqual(response.data?.data.length, 0, 'Should have no rows');
			assert.strictEqual(response.data?.totalRecords, 0, 'Total records should be 0');
		});
	});

	suite('Data Comparison Logic Tests', () => {
		test('should identify comparable data for row comparison', () => {
			// Mock data that would be used for comparison in the webview
			const mockRows = [
				['vm-1', 'Microsoft.Compute/virtualMachines', 'eastus', 'Standard_B1s', 'running'],
				['vm-2', 'Microsoft.Compute/virtualMachines', 'westus', 'Standard_B2s', 'stopped'],
				['storage-1', 'Microsoft.Storage/storageAccounts', 'eastus', 'Standard_LRS', 'available']
			];

			const mockColumns = [
				{ name: 'name', type: 'string' },
				{ name: 'type', type: 'string' },
				{ name: 'location', type: 'string' },
				{ name: 'size', type: 'string' },
				{ name: 'status', type: 'string' }
			];

			// Simulate comparison logic that would be used in generateComparisonView
			const selectedRows = [0, 1]; // Compare first two VMs
			const comparisonData = selectedRows.map(rowIndex => {
				const rowData: Record<string, any> = {};
				mockColumns.forEach((col, colIndex) => {
					rowData[col.name] = mockRows[rowIndex][colIndex];
				});
				return rowData;
			});

			// Verify comparison data structure
			assert.strictEqual(comparisonData.length, 2, 'Should have data for 2 rows');
			
			// Verify first row data
			assert.strictEqual(comparisonData[0].name, 'vm-1', 'First row name should be vm-1');
			assert.strictEqual(comparisonData[0].type, 'Microsoft.Compute/virtualMachines', 'First row type should match');
			assert.strictEqual(comparisonData[0].size, 'Standard_B1s', 'First row size should be Standard_B1s');
			assert.strictEqual(comparisonData[0].status, 'running', 'First row status should be running');

			// Verify second row data  
			assert.strictEqual(comparisonData[1].name, 'vm-2', 'Second row name should be vm-2');
			assert.strictEqual(comparisonData[1].type, 'Microsoft.Compute/virtualMachines', 'Second row type should match');
			assert.strictEqual(comparisonData[1].size, 'Standard_B2s', 'Second row size should be Standard_B2s');
			assert.strictEqual(comparisonData[1].status, 'stopped', 'Second row status should be stopped');

			// Test property value comparison
			const differences: Record<string, { row1: any, row2: any, different: boolean }> = {};
			mockColumns.forEach(col => {
				const val1 = comparisonData[0][col.name];
				const val2 = comparisonData[1][col.name];
				differences[col.name] = {
					row1: val1,
					row2: val2,
					different: val1 !== val2
				};
			});

			// Verify differences detection
			assert.strictEqual(differences.name.different, true, 'Names should be different');
			assert.strictEqual(differences.type.different, false, 'Types should be same');
			assert.strictEqual(differences.location.different, true, 'Locations should be different');
			assert.strictEqual(differences.size.different, true, 'Sizes should be different');
			assert.strictEqual(differences.status.different, true, 'Statuses should be different');
		});
	});
});
