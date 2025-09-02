# bARGE - boosted Azure Resource Graph Explorer

[![bARGE]][bARGEMarketplace] [![bARGEDownloads]][bARGEMarketplace]
[![bARGE]][bARGEMarketplace] [![bARGEDownloads]][bARGEMarketplace]

<img src="media/readme/bARGE.png" width="256">

bARGE is a VS Code extension that brings Azure Resource Graph querying capabilities directly into your development environment, similar to the Azure Portal's Resource Graph Explorer. It adds functionality such as comparison of results and improved data table handling.

## Features

- **Flexible Data Grid**: Excel-like table with column resizing, reordering, and sticky headers
- **Exploring Results**: Click, drag, and keyboard navigation with multi-cell selection support
- **Comparison**: Select two or more rows for comparison to see differences in their properties
- **Copying Options**: Right-click to copy cells, selections, or formatted JSON
- **Querying**: Run queries directly from `.kql` files in your workspace, or from selected text
- **Scope Management**: Query across your tenant or specific subscriptions
- **Authentication**: Seamless integration with VS Code's Azure authentication

## Getting Started

### Prerequisites

- VS Code 1.103.0 or higher
- Access to Azure subscriptions
- One of the following for authentication:
  - Azure CLI installed and logged in (`az login`)
  - Or browser-based authentication (fallback)

### Installation

1. Install the extension from the VS Code marketplace
2. Or [build from source](#building-from-source) for development

### Usage

1. **Authenticate with Azure**
   - Run `az login` in your terminal, or
   - Use VS Code's built-in Azure authentication

2. **Run queries:**
   - **From a .kql file**: Open the file and right click to run `bARGE: Run Query from Current File`
   - **From selected text**: Select KQL text and right click to run `bARGE: Run Selected Query text`  
   - **Open the panel**: Run `bARGE: Open bARGE Results Panel` to view previous results

3. **Set your scope** (optional):
   - Run `bARGE: Set Query Scope` to choose subscription or tenant querying scope

4. **Interact with results:**
   - Resize and reorder columns by dragging
   - Select cells and copy data to Excel or other tools
   - Click JSON objects to view formatted content
   - Export results to CSV using the export button in the results panel

## Example Queries

Here are some useful queries to get you started:

### List all Virtual Machines

```kql
Resources
| where type == 'microsoft.compute/virtualmachines'
| project name, location, resourceGroup, properties.hardwareProfile.vmSize
| limit 100
```

### Find resources by tag

```kql
Resources
| where tags.Environment == 'Production'
| project name, type, location, resourceGroup
| limit 50
```

### Storage accounts by region

```kql
Resources
| where type == 'microsoft.storage/storageaccounts'
| summarize count() by location
| order by count_ desc
```

### Resources created in the last 30 days

```kql
Resources
| where todatetime(properties.timeCreated) > ago(30d)
| project name, type, resourceGroup, properties.timeCreated
| order by todatetime(properties.timeCreated) desc
```

## Configuration

The extension supports the following configuration options in VS Code settings:

- `barge.defaultSubscription`: Default Azure subscription ID to use for queries
- `barge.autoAuthenticate`: Automatically authenticate with Azure on extension activation (default: true)

## Commands

- `barge.openResults`: Open bARGE Results Panel
- `barge.runQueryFromFile`: Run Query from Current File (works with .kql files)
- `barge.runQueryFromSelection`: Run Selected Query text
- `barge.setScope`: Set Query Scope (subscription, management group, or tenant)

## Development

### Building from Source

```bash
git clone https://github.com/PalmEmanuel/bARGE.git
cd bARGE
npm install
npm run watch
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

## Troubleshooting

### Authentication Issues

If you encounter authentication problems:

1. Make sure you're logged into Azure CLI: `az login`
2. Verify you have access to the subscription you're trying to query
3. Try refreshing your browser authentication

### Query Errors

- Ensure your KQL syntax is correct
- Verify you have permissions to query the resources
- Check that the subscription is selected

### Performance

- Use `limit` clauses for large result sets
- Consider filtering early in your queries to improve performance

## Resources

- [Azure Resource Graph Documentation](https://docs.microsoft.com/en-us/azure/governance/resource-graph/)
- [KQL (Kusto Query Language) Reference](https://docs.microsoft.com/en-us/azure/data-explorer/kusto/query/)
- [Azure Resource Graph Sample Queries](https://docs.microsoft.com/en-us/azure/governance/resource-graph/samples/starter)

<!-- References -->
[bARGEDownloads]: https://img.shields.io/visual-studio-marketplace/d/PalmEmanuel.barge-vscode?label=bARGE%20Downloads
[bARGEMarketplace]: https://marketplace.visualstudio.com/items?itemName=PalmEmanuel.barge-vscode
[bARGE]: https://img.shields.io/visual-studio-marketplace/v/PalmEmanuel.barge-vscode?label=bARGE
